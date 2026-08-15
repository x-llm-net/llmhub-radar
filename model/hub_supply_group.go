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
package model

import (
	"errors"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"gorm.io/gorm"
)

const (
	HubSupplyGroupStatusPending   = "pending"
	HubSupplyGroupStatusTesting   = "testing"
	HubSupplyGroupStatusAvailable = "available"
	HubSupplyGroupStatusPartial   = "partial"
	HubSupplyGroupStatusError     = "error"

	HubSupplyGroupDefaultTextProbeMinutes  = 10
	HubSupplyGroupDefaultImageProbeMinutes = 30
)

// HubSupplyGroup is the one-to-one supply extension of a New API Channel.
// Channel owns all upstream configuration; this record only owns LLM-Hub
// commercial, publication, and probe state.
type HubSupplyGroup struct {
	Id                      int     `json:"id" gorm:"primaryKey"`
	PublicId                string  `json:"public_id" gorm:"type:varchar(32);not null;uniqueIndex"`
	ProviderId              int     `json:"-" gorm:"not null;index"`
	NewAPIChannelId         int     `json:"-" gorm:"column:new_api_channel_id;not null;uniqueIndex"`
	PriceMultiplier         float64 `json:"price_multiplier" gorm:"type:real;not null"`
	PublishedModels         string  `json:"-" gorm:"type:text"`
	ProbeEndpointOverrides  string  `json:"-" gorm:"type:text"`
	AutoProbeDisabledModels string  `json:"-" gorm:"type:text"`
	ConfigVersion           int     `json:"config_version" gorm:"not null;default:1"`
	TextProbeMinutes        int     `json:"text_probe_minutes" gorm:"not null;default:10"`
	ImageProbeMinutes       int     `json:"image_probe_minutes" gorm:"not null;default:30"`
	Status                  string  `json:"status" gorm:"type:varchar(24);not null;index"`
	AvailableModelCount     int     `json:"available_model_count" gorm:"not null;default:0"`
	ErrorModelCount         int     `json:"error_model_count" gorm:"not null;default:0"`
	PendingModelCount       int     `json:"pending_model_count" gorm:"not null;default:0"`
	LastProbeAt             int64   `json:"last_probe_at" gorm:"bigint;not null;default:0"`
	LastManualProbeAt       int64   `json:"-" gorm:"bigint;not null;default:0"`
	CreatedAt               int64   `json:"created_at" gorm:"bigint"`
	UpdatedAt               int64   `json:"updated_at" gorm:"bigint"`
}

type HubSupplyGroupWithChannel struct {
	HubSupplyGroup
	ChannelName    string `gorm:"column:channel_name"`
	ChannelType    int    `gorm:"column:channel_type"`
	ChannelBaseURL string `gorm:"column:channel_base_url"`
	ChannelModels  string `gorm:"column:channel_models"`
	ChannelStatus  int    `gorm:"column:channel_status"`
}

type HubSupplyGroupListOptions struct {
	Keyword     string
	Model       string
	Status      string
	ChannelType int
	SortBy      string
	SortOrder   string
	Offset      int
	Limit       int
}

type HubChannelProviderOwnership struct {
	ChannelId       int     `json:"channel_id" gorm:"column:channel_id"`
	ProviderId      int     `json:"provider_id" gorm:"column:provider_id"`
	ProviderName    string  `json:"provider_name" gorm:"column:provider_name"`
	PriceMultiplier float64 `json:"price_multiplier" gorm:"column:price_multiplier"`
}

type HubChannelOwnershipOptions struct {
	PlatformChannelCount int64                      `json:"platform_channel_count"`
	ProviderChannelCount int64                      `json:"provider_channel_count"`
	Providers            []HubChannelProviderOption `json:"providers"`
}

type HubChannelProviderOption struct {
	Id           int    `json:"id" gorm:"column:id"`
	Name         string `json:"name" gorm:"column:name"`
	ChannelCount int64  `json:"channel_count" gorm:"column:channel_count"`
}

func ApplyHubChannelOwnershipFilter(query *gorm.DB, ownership string) *gorm.DB {
	ownership = strings.ToLower(strings.TrimSpace(ownership))
	if ownership == "" || ownership == "all" {
		return query
	}

	supplyChannels := DB.Model(&HubSupplyGroup{}).Select("new_api_channel_id")
	switch {
	case ownership == "platform":
		return query.Where("id NOT IN (?)", supplyChannels)
	case ownership == "provider":
		return query.Where("id IN (?)", supplyChannels)
	case strings.HasPrefix(ownership, "provider:"):
		providerID, err := strconv.Atoi(strings.TrimPrefix(ownership, "provider:"))
		if err != nil || providerID <= 0 {
			return query
		}
		return query.Where(
			"id IN (?)",
			supplyChannels.Where("provider_id = ?", providerID),
		)
	default:
		return query
	}
}

func GetHubChannelProviderOwnership(channelIDs []int) (map[int]HubChannelProviderOwnership, error) {
	result := make(map[int]HubChannelProviderOwnership)
	if len(channelIDs) == 0 || !DB.Migrator().HasTable(&HubSupplyGroup{}) {
		return result, nil
	}

	rows := make([]HubChannelProviderOwnership, 0)
	err := DB.Table("hub_supply_groups AS supply_groups").
		Select(
			"supply_groups.new_api_channel_id AS channel_id, "+
				"supply_groups.price_multiplier AS price_multiplier, "+
				"providers.id AS provider_id, providers.name AS provider_name",
		).
		Joins("JOIN hub_providers AS providers ON providers.id = supply_groups.provider_id").
		Where("supply_groups.new_api_channel_id IN ?", channelIDs).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		result[row.ChannelId] = row
	}
	return result, nil
}

func ResolveHubSupplyServiceTiers(modelsCSV string, multiplier float64, providerID int) []string {
	eligible := make(map[string]struct{})
	for _, modelName := range normalizeHubSupplyModelNames(modelsCSV) {
		family := ClassifyHubPublicModelFamily(modelName)
		for _, tier := range hub_routing_setting.ResolveEligibleServiceTiers(family, multiplier, providerID) {
			eligible[tier] = struct{}{}
		}
	}
	tiers := make([]string, 0, len(eligible))
	for _, tier := range hub_routing_setting.ServiceTiers() {
		if _, ok := eligible[tier]; ok {
			tiers = append(tiers, tier)
		}
	}
	return tiers
}

func GetHubChannelOwnershipOptions() (*HubChannelOwnershipOptions, error) {
	options := &HubChannelOwnershipOptions{
		Providers: make([]HubChannelProviderOption, 0),
	}
	if !DB.Migrator().HasTable(&HubSupplyGroup{}) {
		if err := DB.Model(&Channel{}).Count(&options.PlatformChannelCount).Error; err != nil {
			return nil, err
		}
		return options, nil
	}

	if err := DB.Model(&HubSupplyGroup{}).Count(&options.ProviderChannelCount).Error; err != nil {
		return nil, err
	}
	var totalChannels int64
	if err := DB.Model(&Channel{}).Count(&totalChannels).Error; err != nil {
		return nil, err
	}
	options.PlatformChannelCount = totalChannels - options.ProviderChannelCount
	if options.PlatformChannelCount < 0 {
		options.PlatformChannelCount = 0
	}

	err := DB.Table("hub_providers AS providers").
		Select(
			"providers.id, providers.name, COUNT(supply_groups.id) AS channel_count",
		).
		Joins("JOIN hub_supply_groups AS supply_groups ON supply_groups.provider_id = providers.id").
		Group("providers.id, providers.name").
		Order("providers.name ASC").
		Scan(&options.Providers).Error
	if err != nil {
		return nil, err
	}
	return options, nil
}

func (HubSupplyGroup) TableName() string {
	return "hub_supply_groups"
}

func (group *HubSupplyGroup) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	if group.PublicId == "" {
		group.PublicId = common.GetUUID()
	}
	if group.Status == "" {
		group.Status = HubSupplyGroupStatusPending
	}
	if group.ConfigVersion <= 0 {
		group.ConfigVersion = 1
	}
	if strings.TrimSpace(group.ProbeEndpointOverrides) == "" {
		group.ProbeEndpointOverrides = "{}"
	}
	group.PublishedModels = strings.Join(normalizeHubSupplyModelNames(group.PublishedModels), ",")
	group.AutoProbeDisabledModels = strings.Join(normalizeHubSupplyModelNames(group.AutoProbeDisabledModels), ",")
	if group.TextProbeMinutes <= 0 {
		group.TextProbeMinutes = HubSupplyGroupDefaultTextProbeMinutes
	}
	if group.ImageProbeMinutes <= 0 {
		group.ImageProbeMinutes = HubSupplyGroupDefaultImageProbeMinutes
	}
	group.CreatedAt = now
	group.UpdatedAt = now
	return nil
}

func normalizeHubSupplyModelNames(modelsCSV string) []string {
	seen := make(map[string]struct{})
	models := make([]string, 0)
	for _, modelName := range strings.Split(modelsCSV, ",") {
		modelName = strings.TrimSpace(modelName)
		if modelName == "" {
			continue
		}
		if _, exists := seen[modelName]; exists {
			continue
		}
		seen[modelName] = struct{}{}
		models = append(models, modelName)
	}
	return models
}

func (group *HubSupplyGroup) GetPublishedModels(configuredModelsCSV string) []string {
	if group == nil || strings.TrimSpace(group.PublishedModels) == "" {
		return []string{}
	}
	published := make(map[string]struct{})
	for _, modelName := range strings.Split(group.PublishedModels, ",") {
		modelName = strings.TrimSpace(modelName)
		if modelName != "" {
			published[modelName] = struct{}{}
		}
	}
	models := make([]string, 0, len(published))
	for _, modelName := range normalizeHubSupplyModelNames(configuredModelsCSV) {
		if _, ok := published[modelName]; ok {
			models = append(models, modelName)
		}
	}
	return models
}

func (group *HubSupplyGroup) GetAutoProbeDisabledModels(configuredModelsCSV string) []string {
	if group == nil || strings.TrimSpace(group.AutoProbeDisabledModels) == "" {
		return []string{}
	}
	disabled := make(map[string]struct{})
	for _, modelName := range normalizeHubSupplyModelNames(group.AutoProbeDisabledModels) {
		disabled[modelName] = struct{}{}
	}
	models := make([]string, 0, len(disabled))
	for _, modelName := range normalizeHubSupplyModelNames(configuredModelsCSV) {
		if _, ok := disabled[modelName]; ok {
			models = append(models, modelName)
		}
	}
	return models
}

func (group *HubSupplyGroup) IsAutoProbeDisabled(modelName string, configuredModelsCSV string) bool {
	modelName = strings.TrimSpace(modelName)
	for _, disabledModel := range group.GetAutoProbeDisabledModels(configuredModelsCSV) {
		if disabledModel == modelName {
			return true
		}
	}
	return false
}

func getHubSupplyChannelAbilityModels(tx *gorm.DB, channel *Channel) ([]string, error) {
	if channel == nil {
		return []string{}, nil
	}
	configuredModels := channel.GetModels()
	if channel.Id <= 0 {
		return configuredModels, nil
	}
	query := DB
	if tx != nil {
		query = tx
	}
	var group HubSupplyGroup
	err := query.Where("new_api_channel_id = ?", channel.Id).First(&group).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return configuredModels, nil
	}
	if err != nil {
		if !query.Migrator().HasTable(&HubSupplyGroup{}) {
			return configuredModels, nil
		}
		return nil, err
	}

	var targets []HubSupplyGroupProbeTarget
	if err := query.Where("group_id = ? AND config_version = ?", group.Id, group.ConfigVersion).Find(&targets).Error; err != nil {
		return nil, err
	}
	probeKinds := buildHubSupplyModelProbeKinds(targets)
	autoProbeDisabled := make(map[string]struct{})
	for _, modelName := range group.GetAutoProbeDisabledModels(channel.Models) {
		autoProbeDisabled[modelName] = struct{}{}
	}

	routableModels := make([]string, 0)
	for _, modelName := range group.GetPublishedModels(channel.Models) {
		_, probeDisabled := autoProbeDisabled[modelName]
		if probeDisabled || hubSupplyModelHasAvailableProbeKind(probeKinds, modelName) {
			routableModels = append(routableModels, modelName)
		}
	}
	return routableModels, nil
}

func GetHubSupplyChannelRoutableModels(channelID int) ([]string, error) {
	channel, err := GetChannelById(channelID, false)
	if err != nil {
		return nil, err
	}
	return getHubSupplyChannelAbilityModels(nil, channel)
}

func hubSupplyStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

// HubSupplyChannelConnectionChanged compares the Channel fields that affect
// real upstream requests. Both the native admin editor and the provider editor
// use this definition so probe revisions cannot drift between the two paths.
func HubSupplyChannelConnectionChanged(before, after *Channel) bool {
	if before == nil || after == nil {
		return true
	}
	return before.Type != after.Type ||
		before.Key != after.Key ||
		before.GetBaseURL() != after.GetBaseURL() ||
		before.Models != after.Models ||
		hubSupplyStringValue(before.OpenAIOrganization) != hubSupplyStringValue(after.OpenAIOrganization) ||
		before.Other != after.Other ||
		before.GetModelMapping() != after.GetModelMapping() ||
		before.GetSetting() != after.GetSetting() ||
		hubSupplyStringValue(before.ParamOverride) != hubSupplyStringValue(after.ParamOverride) ||
		hubSupplyStringValue(before.HeaderOverride) != hubSupplyStringValue(after.HeaderOverride) ||
		before.OtherSettings != after.OtherSettings
}

func (group *HubSupplyGroup) normalizePublishedModels(configuredModelsCSV string) {
	group.PublishedModels = strings.Join(group.GetPublishedModels(configuredModelsCSV), ",")
}

func (group *HubSupplyGroup) normalizeAutoProbeDisabledModels(configuredModelsCSV string) {
	group.AutoProbeDisabledModels = strings.Join(group.GetAutoProbeDisabledModels(configuredModelsCSV), ",")
}

func (group *HubSupplyGroup) GetProbeEndpointOverrides(configuredModelsCSV string) map[string]string {
	overrides := make(map[string]string)
	if group == nil || strings.TrimSpace(group.ProbeEndpointOverrides) == "" {
		return overrides
	}
	var stored map[string]string
	if err := common.Unmarshal([]byte(group.ProbeEndpointOverrides), &stored); err != nil {
		return overrides
	}
	configuredModels := make(map[string]struct{})
	for _, modelName := range normalizeHubSupplyModelNames(configuredModelsCSV) {
		configuredModels[modelName] = struct{}{}
	}
	for modelName, endpointType := range stored {
		modelName = strings.TrimSpace(modelName)
		endpointType = NormalizeHubSupplyProbeEndpointMode(endpointType)
		if modelName == "" || endpointType == "" || endpointType == HubSupplyProbeEndpointModeAuto {
			continue
		}
		if _, configured := configuredModels[modelName]; !configured {
			continue
		}
		overrides[modelName] = endpointType
	}
	return overrides
}

func (group *HubSupplyGroup) GetProbeEndpointMode(modelName string, configuredModelsCSV string) string {
	if endpointType := group.GetProbeEndpointOverrides(configuredModelsCSV)[strings.TrimSpace(modelName)]; endpointType != "" {
		return endpointType
	}
	return HubSupplyProbeEndpointModeAuto
}

func (group *HubSupplyGroup) normalizeProbeEndpointOverrides(configuredModelsCSV string) error {
	overrides, err := common.Marshal(group.GetProbeEndpointOverrides(configuredModelsCSV))
	if err != nil {
		return err
	}
	group.ProbeEndpointOverrides = string(overrides)
	return nil
}

func (group *HubSupplyGroup) BeforeUpdate(tx *gorm.DB) error {
	group.UpdatedAt = common.GetTimestamp()
	return nil
}

func CreateHubSupplyGroup(group *HubSupplyGroup, channel *Channel) error {
	if group == nil || channel == nil || group.ProviderId <= 0 {
		return errors.New("invalid hub supply group")
	}
	if group.PublicId == "" {
		group.PublicId = common.GetUUID()
	}
	group.normalizePublishedModels(channel.Models)
	if err := group.normalizeProbeEndpointOverrides(channel.Models); err != nil {
		return err
	}
	group.PendingModelCount = len(channel.GetModels())

	channels := []Channel{*channel}
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := insertChannelsTx(tx, channels); err != nil {
			return err
		}
		*channel = channels[0]
		return createHubSupplyGroupExtensionTx(tx, group, channel)
	})
	if err != nil {
		return err
	}

	InitChannelCache()
	return nil
}

func createHubSupplyGroupExtensionTx(tx *gorm.DB, group *HubSupplyGroup, channel *Channel) error {
	if tx == nil || group == nil || channel == nil {
		return errors.New("invalid hub supply channel")
	}
	group.normalizePublishedModels(channel.Models)
	if err := group.normalizeProbeEndpointOverrides(channel.Models); err != nil {
		return err
	}
	group.PendingModelCount = len(channel.GetModels())
	group.NewAPIChannelId = channel.Id
	if err := tx.Create(group).Error; err != nil {
		return err
	}
	if err := createHubSupplyGroupRevisionTx(tx, group, channel); err != nil {
		return err
	}
	if err := syncHubSupplyGroupProbeTargetsTx(tx, group, channel); err != nil {
		return err
	}
	// The native insert path creates abilities before the supply extension
	// exists. Reconcile after the extension is present so unverified supply
	// models never enter the routing pool.
	return channel.UpdateAbilities(tx)
}

func CreateHubSupplyChannels(providerID int, channels []Channel, settings HubSupplyGroup) ([]HubSupplyGroup, error) {
	if providerID <= 0 || len(channels) == 0 {
		return nil, errors.New("invalid hub supply channels")
	}
	groups := make([]HubSupplyGroup, 0, len(channels))
	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := insertChannelsTx(tx, channels); err != nil {
			return err
		}
		for i := range channels {
			group := settings
			group.Id = 0
			group.PublicId = common.GetUUID()
			group.ProviderId = providerID
			group.NewAPIChannelId = 0
			group.PublishedModels = channels[i].Models
			group.CreatedAt = 0
			group.UpdatedAt = 0
			if err := createHubSupplyGroupExtensionTx(tx, &group, &channels[i]); err != nil {
				return err
			}
			groups = append(groups, group)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	InitChannelCache()
	return groups, nil
}

func GetHubSupplyGroupsByProviderID(providerID int) ([]HubSupplyGroupWithChannel, error) {
	groups, _, _, err := ListHubSupplyGroupsByProviderID(providerID, HubSupplyGroupListOptions{})
	return groups, err
}

func ListHubSupplyGroupsByProviderID(providerID int, options HubSupplyGroupListOptions) ([]HubSupplyGroupWithChannel, int64, map[int]int64, error) {
	groups := make([]HubSupplyGroupWithChannel, 0)
	query := DB.Table("hub_supply_groups AS supply_groups").
		Joins("JOIN channels ON channels.id = supply_groups.new_api_channel_id").
		Where("supply_groups.provider_id = ?", providerID)
	keyword := strings.TrimSpace(options.Keyword)
	if keyword != "" {
		pattern := "%" + strings.ToLower(keyword) + "%"
		query = query.Where(
			"LOWER(channels.name) LIKE ? OR LOWER(COALESCE(channels.base_url, '')) LIKE ?",
			pattern, pattern,
		)
	}
	modelName := strings.TrimSpace(options.Model)
	if modelName != "" {
		query = query.Where("LOWER(channels.models) LIKE ?", "%"+strings.ToLower(modelName)+"%")
	}
	if options.Status != "" {
		query = query.Where("supply_groups.status = ?", options.Status)
	}
	typeCountQuery := query.Session(&gorm.Session{})
	listQuery := query.Session(&gorm.Session{})

	var typeCountRows []struct {
		ChannelType int   `gorm:"column:channel_type"`
		Count       int64 `gorm:"column:count"`
	}
	if err := typeCountQuery.Select("channels.type AS channel_type, COUNT(*) AS count").
		Group("channels.type").
		Scan(&typeCountRows).Error; err != nil {
		return nil, 0, nil, err
	}
	typeCounts := make(map[int]int64, len(typeCountRows))
	for _, row := range typeCountRows {
		typeCounts[row.ChannelType] = row.Count
	}

	if options.ChannelType > 0 {
		listQuery = listQuery.Where("channels.type = ?", options.ChannelType)
	}
	var total int64
	if err := listQuery.Count(&total).Error; err != nil {
		return nil, 0, nil, err
	}

	sortColumn := "supply_groups.id"
	switch options.SortBy {
	case "id":
		sortColumn = "channels.id"
	case "name":
		sortColumn = "channels.name"
	case "price_multiplier":
		sortColumn = "supply_groups.price_multiplier"
	case "status":
		sortColumn = "supply_groups.status"
	case "last_probe_at":
		sortColumn = "supply_groups.last_probe_at"
	case "updated_at":
		sortColumn = "supply_groups.updated_at"
	}
	sortOrder := "DESC"
	if strings.EqualFold(options.SortOrder, "asc") {
		sortOrder = "ASC"
	}

	listQuery = listQuery.
		Select("supply_groups.*, channels.name AS channel_name, channels.type AS channel_type, channels.base_url AS channel_base_url, channels.models AS channel_models, channels.status AS channel_status").
		Order(sortColumn + " " + sortOrder)
	if options.Limit > 0 {
		listQuery = listQuery.Limit(options.Limit).Offset(options.Offset)
	}
	if err := listQuery.Scan(&groups).Error; err != nil {
		return nil, 0, nil, err
	}
	return groups, total, typeCounts, nil
}

func GetHubSupplyGroupByPublicID(providerID int, publicID string) (*HubSupplyGroup, error) {
	var group HubSupplyGroup
	err := DB.Where("provider_id = ? AND public_id = ?", providerID, publicID).First(&group).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &group, nil
}

// UpdateHubSupplyChannel persists the native Channel through the same update
// path used by the admin editor, then updates only the LLM-Hub supply fields.
// This keeps future Channel fields, abilities, and probe synchronization from
// drifting between the admin and provider editors.
func UpdateHubSupplyChannel(group *HubSupplyGroup, channel *Channel) error {
	if group == nil || channel == nil || group.Id <= 0 || channel.Id != group.NewAPIChannelId {
		return errors.New("invalid hub supply group update")
	}
	group.UpdatedAt = common.GetTimestamp()
	channel.prepareUpdate()

	err := DB.Transaction(func(tx *gorm.DB) error {
		if err := channel.updateTx(tx); err != nil {
			return err
		}
		if err := tx.Model(&HubSupplyGroup{Id: group.Id}).Select(
			"price_multiplier",
			"text_probe_minutes",
			"image_probe_minutes",
			"updated_at",
		).Updates(group).Error; err != nil {
			return err
		}
		// channel.updateTx rebuilds abilities before the supply extension is
		// updated. Rebuild once more so a multiplier change takes effect now.
		return channel.UpdateAbilities(tx)
	})
	if err != nil {
		return err
	}

	InitChannelCache()
	return nil
}

func GetHubSupplyGroupByChannelID(channelID int) (*HubSupplyGroup, error) {
	var group HubSupplyGroup
	err := DB.Where("new_api_channel_id = ?", channelID).First(&group).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &group, nil
}

// syncHubSupplyGroupFromChannelTx keeps the one-to-one supply extension aligned
// when the underlying Channel is edited through the native admin path.
func syncHubSupplyGroupFromChannelTx(tx *gorm.DB, before, channel *Channel) error {
	if tx == nil || channel == nil || channel.Id <= 0 {
		return nil
	}
	if !tx.Migrator().HasTable(&HubSupplyGroup{}) {
		return nil
	}
	var group HubSupplyGroup
	err := tx.Where("new_api_channel_id = ?", channel.Id).First(&group).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	group.normalizePublishedModels(channel.Models)
	group.normalizeAutoProbeDisabledModels(channel.Models)
	if err := group.normalizeProbeEndpointOverrides(channel.Models); err != nil {
		return err
	}
	connectionChanged := HubSupplyChannelConnectionChanged(before, channel)
	updates := map[string]any{
		"published_models":           group.PublishedModels,
		"probe_endpoint_overrides":   group.ProbeEndpointOverrides,
		"auto_probe_disabled_models": group.AutoProbeDisabledModels,
		"updated_at":                 common.GetTimestamp(),
	}
	if connectionChanged {
		group.ConfigVersion++
		if group.ConfigVersion <= 1 {
			group.ConfigVersion = 2
		}
		group.Status = HubSupplyGroupStatusPending
		group.AvailableModelCount = 0
		group.ErrorModelCount = 0
		group.PendingModelCount = len(channel.GetModels())
		group.LastProbeAt = 0
		channel.Status = common.ChannelStatusAutoDisabled
		if before != nil && before.Status == common.ChannelStatusManuallyDisabled {
			channel.Status = common.ChannelStatusManuallyDisabled
		}
		updates["config_version"] = group.ConfigVersion
		updates["status"] = group.Status
		updates["available_model_count"] = 0
		updates["error_model_count"] = 0
		updates["pending_model_count"] = group.PendingModelCount
		updates["last_probe_at"] = 0
	}
	if err := tx.Model(&HubSupplyGroup{Id: group.Id}).Updates(updates).Error; err != nil {
		return err
	}
	if connectionChanged {
		if err := tx.Model(&Channel{Id: channel.Id}).Update("status", channel.Status).Error; err != nil {
			return err
		}
		if err := createHubSupplyGroupRevisionTx(tx, &group, channel); err != nil {
			return err
		}
	}
	return syncHubSupplyGroupProbeTargetsTx(tx, &group, channel)
}

func GetHubSupplyChannelIDSet() (map[int]struct{}, error) {
	channelIDs := make([]int, 0)
	if !DB.Migrator().HasTable(&HubSupplyGroup{}) {
		return map[int]struct{}{}, nil
	}
	if err := DB.Model(&HubSupplyGroup{}).Pluck("new_api_channel_id", &channelIDs).Error; err != nil {
		return nil, err
	}
	result := make(map[int]struct{}, len(channelIDs))
	for _, channelID := range channelIDs {
		result[channelID] = struct{}{}
	}
	return result, nil
}

func deleteHubSupplyGroupsByChannelIDsTx(tx *gorm.DB, channelIDs []int) error {
	if tx == nil || len(channelIDs) == 0 {
		return nil
	}
	if !tx.Migrator().HasTable(&HubSupplyGroup{}) {
		return nil
	}
	var groupIDs []int
	if err := tx.Model(&HubSupplyGroup{}).
		Where("new_api_channel_id IN ?", channelIDs).
		Pluck("id", &groupIDs).Error; err != nil {
		return err
	}
	if len(groupIDs) == 0 {
		return nil
	}
	if err := tx.Where("group_id IN ?", groupIDs).Delete(&HubSupplyGroupProbeSample{}).Error; err != nil {
		return err
	}
	if err := tx.Where("group_id IN ?", groupIDs).Delete(&HubSupplyGroupProbeTarget{}).Error; err != nil {
		return err
	}
	if err := tx.Where("group_id IN ?", groupIDs).Delete(&HubSupplyGroupRevision{}).Error; err != nil {
		return err
	}
	return tx.Where("id IN ?", groupIDs).Delete(&HubSupplyGroup{}).Error
}

func UpdateHubSupplyGroupModelPublication(groupID int, modelName string, published bool) error {
	return UpdateHubSupplyGroupModelsPublication(groupID, []string{modelName}, published)
}

func UpdateHubSupplyGroupModelsPublication(groupID int, modelNames []string, published bool) error {
	requestedModels := make([]string, 0, len(modelNames))
	requestedSet := make(map[string]struct{}, len(modelNames))
	for _, modelName := range modelNames {
		modelName = strings.TrimSpace(modelName)
		if modelName == "" {
			return ErrHubSupplyProbeModelNotFound
		}
		if _, exists := requestedSet[modelName]; exists {
			continue
		}
		requestedSet[modelName] = struct{}{}
		requestedModels = append(requestedModels, modelName)
	}
	if groupID <= 0 || len(requestedModels) == 0 {
		return ErrHubSupplyProbeModelNotFound
	}
	err := DB.Transaction(func(tx *gorm.DB) error {
		var group HubSupplyGroup
		if err := lockForUpdate(tx).First(&group, groupID).Error; err != nil {
			return err
		}
		var channel Channel
		if err := tx.First(&channel, group.NewAPIChannelId).Error; err != nil {
			return err
		}
		configured := channel.GetModels()
		configuredSet := make(map[string]struct{}, len(configured))
		for _, configuredModel := range configured {
			configuredSet[configuredModel] = struct{}{}
		}
		for _, modelName := range requestedModels {
			if _, ok := configuredSet[modelName]; !ok {
				return ErrHubSupplyProbeModelNotFound
			}
		}

		publishedSet := make(map[string]struct{})
		for _, publishedModel := range group.GetPublishedModels(channel.Models) {
			publishedSet[publishedModel] = struct{}{}
		}
		for _, modelName := range requestedModels {
			if published {
				publishedSet[modelName] = struct{}{}
			} else {
				delete(publishedSet, modelName)
			}
		}
		publishedModels := make([]string, 0, len(publishedSet))
		for _, configuredModel := range configured {
			if _, ok := publishedSet[configuredModel]; ok {
				publishedModels = append(publishedModels, configuredModel)
			}
		}
		if err := tx.Model(&HubSupplyGroup{Id: group.Id}).Updates(map[string]any{
			"published_models": strings.Join(publishedModels, ","),
			"updated_at":       common.GetTimestamp(),
		}).Error; err != nil {
			return err
		}
		return reconcileHubSupplyGroupRouteStateTx(tx, group.Id)
	})
	if err != nil {
		return err
	}
	InitChannelCache()
	return nil
}
