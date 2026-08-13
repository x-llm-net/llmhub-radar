/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package controller

import (
	"context"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
)

const (
	hubSupplyProbeBatchSize         = 2000
	hubSupplyProbeTextConcurrency   = 20
	hubSupplyProbeImageConcurrency  = 3
	hubSupplyProbeTextTimeout       = 90 * time.Second
	hubSupplyProbeImageTimeout      = 3 * time.Minute
	hubSupplyProbeObserverErrorCode = "hub_probe_observer_error"
)

type hubSupplyProbeResult struct {
	job                  model.HubSupplyProbeJob
	success              bool
	latencyMs            int64
	firstTokenMs         *int64
	err                  error
	errorCode            string
	resolvedEndpointType string
}

type hubSupplyProbeSummary struct {
	Due       int `json:"due"`
	Tested    int `json:"tested"`
	Succeeded int `json:"succeeded"`
	Failed    int `json:"failed"`
	Groups    int `json:"groups"`
}

var (
	hubSupplyProbePersistenceMu     sync.Mutex
	immediateHubSupplyProbeExecutor = executeHubSupplyProbe
)

func persistHubSupplyProbeResult(result hubSupplyProbeResult) (int, bool, error) {
	hubSupplyProbePersistenceMu.Lock()
	defer hubSupplyProbePersistenceMu.Unlock()
	errorMessage := ""
	if result.err != nil {
		errorMessage = result.err.Error()
	}
	return model.RecordHubSupplyProbeResultWithTTFT(
		result.job.TargetId,
		result.success,
		result.latencyMs,
		result.firstTokenMs,
		errorMessage,
		result.errorCode,
		result.resolvedEndpointType,
	)
}

func reconcileHubSupplyGroupRouteState(groupID int) error {
	hubSupplyProbePersistenceMu.Lock()
	defer hubSupplyProbePersistenceMu.Unlock()
	return model.ReconcileHubSupplyGroupRouteState(groupID)
}

func runHubSupplyProbeTask(ctx context.Context, report func(processed, total int)) (hubSupplyProbeSummary, error) {
	if err := model.EnsureHubSupplyGroupProbeTargets(); err != nil {
		return hubSupplyProbeSummary{}, err
	}
	jobs, err := model.GetDueHubSupplyProbeJobs(common.GetTimestamp(), hubSupplyProbeBatchSize)
	if err != nil {
		return hubSupplyProbeSummary{}, err
	}
	summary := hubSupplyProbeSummary{Due: len(jobs)}
	if len(jobs) == 0 {
		if report != nil {
			report(0, 0)
		}
		return summary, nil
	}
	testUserID, err := resolveChannelTestUserID(nil)
	if err != nil {
		return summary, err
	}
	targetIDs := make([]int, 0, len(jobs))
	groupIDSet := make(map[int]struct{})
	remainingByGroup := make(map[int]int)
	for _, job := range jobs {
		targetIDs = append(targetIDs, job.TargetId)
		groupIDSet[job.GroupId] = struct{}{}
		remainingByGroup[job.GroupId]++
	}
	if err := model.MarkHubSupplyProbeTargetsTesting(targetIDs); err != nil {
		return summary, err
	}
	groupIDsToMark := make([]int, 0, len(groupIDSet))
	for groupID := range groupIDSet {
		groupIDsToMark = append(groupIDsToMark, groupID)
	}
	if err := model.MarkHubSupplyGroupsTesting(groupIDsToMark); err != nil {
		return summary, err
	}

	results := make(chan hubSupplyProbeResult, len(jobs))
	textJobs := make([]model.HubSupplyProbeJob, 0, len(jobs))
	imageJobs := make([]model.HubSupplyProbeJob, 0)
	for _, job := range jobs {
		if result, failed := preflightHubSupplyProbePricing(ctx, job, testUserID); failed {
			results <- result
			continue
		}
		if job.ProbeKind == model.HubSupplyProbeKindImage {
			imageJobs = append(imageJobs, job)
		} else {
			textJobs = append(textJobs, job)
		}
	}

	textConcurrency := hubSupplyProbeTextConcurrency
	imageConcurrency := hubSupplyProbeImageConcurrency
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		textConcurrency = 4
		imageConcurrency = 1
	}
	var pools sync.WaitGroup
	pools.Add(2)
	go func() {
		defer pools.Done()
		runHubSupplyProbePool(ctx, textJobs, textConcurrency, testUserID, hubSupplyProbeTextTimeout, results)
	}()
	go func() {
		defer pools.Done()
		runHubSupplyProbePool(ctx, imageJobs, imageConcurrency, testUserID, hubSupplyProbeImageTimeout, results)
	}()
	go func() {
		pools.Wait()
		close(results)
	}()

	affectedGroups := make(map[int]struct{})
	reconciledGroups := make(map[int]struct{})
	for result := range results {
		if ctx != nil && ctx.Err() != nil {
			return summary, ctx.Err()
		}
		groupID, isCurrent, recordErr := persistHubSupplyProbeResult(result)
		if recordErr != nil {
			return summary, recordErr
		}
		if isCurrent {
			affectedGroups[groupID] = struct{}{}
		}
		remainingByGroup[result.job.GroupId]--
		if remainingByGroup[result.job.GroupId] == 0 {
			if _, affected := affectedGroups[result.job.GroupId]; affected {
				if err := reconcileHubSupplyGroupRouteState(result.job.GroupId); err != nil {
					return summary, err
				}
				reconciledGroups[result.job.GroupId] = struct{}{}
			}
		}
		summary.Tested++
		if result.success {
			summary.Succeeded++
		} else {
			summary.Failed++
		}
		if report != nil {
			report(summary.Tested, len(jobs))
		}
	}

	groupIDs := make([]int, 0, len(affectedGroups))
	for groupID := range affectedGroups {
		if _, reconciled := reconciledGroups[groupID]; !reconciled {
			groupIDs = append(groupIDs, groupID)
		}
	}
	sort.Ints(groupIDs)
	for _, groupID := range groupIDs {
		if err := reconcileHubSupplyGroupRouteState(groupID); err != nil {
			return summary, err
		}
	}
	summary.Groups = len(reconciledGroups)
	return summary, nil
}

func runImmediateHubSupplyModelProbe(ctx context.Context, groupID int, modelName string) (bool, error) {
	jobs, err := model.GetHubSupplyGroupModelProbeJobs(groupID, modelName)
	if err != nil {
		return false, err
	}
	if len(jobs) == 0 {
		return false, model.ErrHubSupplyProbeModelNotFound
	}
	testUserID, err := resolveChannelTestUserID(nil)
	if err != nil {
		return false, err
	}
	targetIDs := make([]int, 0, len(jobs))
	for _, job := range jobs {
		targetIDs = append(targetIDs, job.TargetId)
	}
	if err := model.MarkHubSupplyProbeTargetsTesting(targetIDs); err != nil {
		return false, err
	}
	if err := model.MarkHubSupplyGroupsTesting([]int{groupID}); err != nil {
		return false, err
	}

	results := make(chan hubSupplyProbeResult, len(jobs))
	var workers sync.WaitGroup
	for _, job := range jobs {
		workers.Add(1)
		go func(job model.HubSupplyProbeJob) {
			defer workers.Done()
			if result, failed := preflightHubSupplyProbePricing(ctx, job, testUserID); failed {
				results <- result
				return
			}
			timeout := hubSupplyProbeTextTimeout
			if job.ProbeKind == model.HubSupplyProbeKindImage {
				timeout = hubSupplyProbeImageTimeout
			}
			results <- immediateHubSupplyProbeExecutor(ctx, job, testUserID, timeout)
		}(job)
	}
	go func() {
		workers.Wait()
		close(results)
	}()

	allSucceeded := true
	shouldReconcile := false
	for result := range results {
		_, isCurrent, recordErr := persistHubSupplyProbeResult(result)
		if recordErr != nil {
			return false, recordErr
		}
		shouldReconcile = shouldReconcile || isCurrent
		allSucceeded = allSucceeded && result.success
	}
	if shouldReconcile {
		if err := reconcileHubSupplyGroupRouteState(groupID); err != nil {
			return false, err
		}
	}
	return allSucceeded, nil
}

func preflightHubSupplyProbePricing(ctx context.Context, job model.HubSupplyProbeJob, testUserID int) (hubSupplyProbeResult, bool) {
	result := hubSupplyProbeResult{job: job}
	channel, err := model.GetChannelById(job.NewAPIChannelId, true)
	if err != nil {
		result.err = err
		result.errorCode = hubSupplyProbeObserverErrorCode
		return result, true
	}
	channel.Models = job.ConfiguredModels
	startedAt := time.Now()
	testResult := testChannelPricingPreflight(ctx, channel, testUserID, job.ModelName, job.EndpointType)
	result.latencyMs = time.Since(startedAt).Milliseconds()
	if testResult.newAPIError != nil {
		result.errorCode = string(testResult.newAPIError.GetErrorCode())
	} else if testResult.localErr != nil {
		result.errorCode = hubSupplyProbeObserverErrorCode
	}
	if testResult.localErr != nil {
		result.err = testResult.localErr
		return result, true
	}
	if testResult.newAPIError != nil {
		result.err = testResult.newAPIError
		return result, true
	}
	return result, false
}

func runHubSupplyProbePool(
	ctx context.Context,
	jobs []model.HubSupplyProbeJob,
	concurrency int,
	testUserID int,
	timeout time.Duration,
	results chan<- hubSupplyProbeResult,
) {
	if len(jobs) == 0 {
		return
	}
	if concurrency < 1 {
		concurrency = 1
	}
	jobQueue := make(chan model.HubSupplyProbeJob)
	var workers sync.WaitGroup
	for index := 0; index < concurrency; index++ {
		workers.Add(1)
		go func() {
			defer workers.Done()
			for job := range jobQueue {
				results <- executeHubSupplyProbe(ctx, job, testUserID, timeout)
			}
		}()
	}
	for _, job := range jobs {
		select {
		case <-ctx.Done():
			close(jobQueue)
			workers.Wait()
			return
		case jobQueue <- job:
		}
	}
	close(jobQueue)
	workers.Wait()
}

func shouldStreamHubSupplyProbe(job model.HubSupplyProbeJob, endpointType string) bool {
	if job.ProbeKind != model.HubSupplyProbeKindText {
		return false
	}
	modelName := strings.ToLower(strings.TrimSpace(job.ModelName))
	if strings.Contains(modelName, "embedding") || strings.Contains(modelName, "embed") ||
		strings.Contains(modelName, "rerank") || strings.HasPrefix(modelName, "m3e") ||
		strings.Contains(modelName, "bge-") {
		return false
	}
	switch constant.EndpointType(strings.TrimSpace(endpointType)) {
	case constant.EndpointTypeEmbeddings, constant.EndpointTypeJinaRerank,
		constant.EndpointTypeImageGeneration, constant.EndpointTypeOpenAIResponseCompact:
		return false
	default:
		return true
	}
}

func executeHubSupplyProbe(ctx context.Context, job model.HubSupplyProbeJob, testUserID int, timeout time.Duration) hubSupplyProbeResult {
	result := hubSupplyProbeResult{job: job}
	channel, err := model.GetChannelById(job.NewAPIChannelId, true)
	if err != nil {
		result.err = err
		result.errorCode = hubSupplyProbeObserverErrorCode
		return result
	}
	channel.Models = job.ConfiguredModels
	requestCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	startedAt := time.Now()
	probeEndpointType := strings.TrimSpace(job.ResolvedEndpointType)
	if probeEndpointType == "" {
		probeEndpointType = job.EndpointType
	}
	streamProbe := shouldStreamHubSupplyProbe(job, probeEndpointType)
	for attempt := 0; attempt < 2; attempt++ {
		testResult := testChannel(requestCtx, channel, testUserID, job.ModelName, probeEndpointType, streamProbe)
		result.latencyMs = time.Since(startedAt).Milliseconds()
		result.firstTokenMs = testResult.firstTokenMs
		result.err = testResult.localErr
		result.errorCode = ""
		if testResult.newAPIError != nil {
			result.errorCode = string(testResult.newAPIError.GetErrorCode())
			if result.err == nil {
				result.err = testResult.newAPIError
			}
		} else if testResult.localErr != nil {
			result.errorCode = hubSupplyProbeObserverErrorCode
		}
		if testResult.localErr == nil && testResult.newAPIError == nil {
			result.success = true
			result.err = nil
			result.errorCode = ""
			result.resolvedEndpointType = probeEndpointType
			return result
		}
		alternateEndpointType := alternateHubSupplyOpenAIEndpoint(job, probeEndpointType, testResult.upstreamStatusCode)
		if alternateEndpointType == "" {
			return result
		}
		probeEndpointType = alternateEndpointType
	}
	return result
}

func alternateHubSupplyOpenAIEndpoint(job model.HubSupplyProbeJob, endpointType string, upstreamStatusCode int) string {
	if model.NormalizeHubSupplyProbeEndpointMode(job.EndpointMode) != model.HubSupplyProbeEndpointModeAuto ||
		job.ProbeKind != model.HubSupplyProbeKindText ||
		(upstreamStatusCode != http.StatusBadRequest &&
			upstreamStatusCode != http.StatusNotFound &&
			upstreamStatusCode != http.StatusMethodNotAllowed) {
		return ""
	}
	switch constant.EndpointType(endpointType) {
	case constant.EndpointTypeOpenAI:
		return string(constant.EndpointTypeOpenAIResponse)
	case constant.EndpointTypeOpenAIResponse:
		return string(constant.EndpointTypeOpenAI)
	default:
		return ""
	}
}
