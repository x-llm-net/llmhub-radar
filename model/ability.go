package model

import (
	"errors"
	"fmt"
	"sort"
	"strings"
	"sync"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/relaykit/dto"
	"github.com/QuantumNous/new-api/setting/hub_routing_setting"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/samber/lo"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

type Ability struct {
	Group     string  `json:"group" gorm:"type:varchar(64);primaryKey;autoIncrement:false"`
	Model     string  `json:"model" gorm:"type:varchar(255);primaryKey;autoIncrement:false"`
	ChannelId int     `json:"channel_id" gorm:"primaryKey;autoIncrement:false;index"`
	Enabled   bool    `json:"enabled"`
	Priority  *int64  `json:"priority" gorm:"bigint;default:0;index"`
	Weight    uint    `json:"weight" gorm:"default:0;index"`
	Tag       *string `json:"tag" gorm:"index"`
}

type AbilityWithChannel struct {
	Ability
	ChannelType int `json:"channel_type"`
}

func abilityGroupColumn() string {
	if commonGroupCol != "" {
		return commonGroupCol
	}
	if common.UsingMainDatabase(common.DatabaseTypePostgreSQL) {
		return `"group"`
	}
	return "`group`"
}

func GetAllEnableAbilityWithChannels() ([]AbilityWithChannel, error) {
	var abilities []AbilityWithChannel
	err := DB.Table("abilities").
		Select("abilities.*, channels.type as channel_type").
		Joins("left join channels on abilities.channel_id = channels.id").
		Where("abilities.enabled = ?", true).
		Scan(&abilities).Error
	return abilities, err
}

func GetGroupEnabledModels(group string) []string {
	var models []string
	// Find distinct models
	DB.Table("abilities").Where(abilityGroupColumn()+" = ? and enabled = ?", group, true).Distinct("model").Pluck("model", &models)
	return models
}

func GetEnabledModels() []string {
	var models []string
	// Find distinct models
	DB.Table("abilities").Where("enabled = ?", true).Distinct("model").Pluck("model", &models)
	return models
}

func GetAllEnableAbilities() []Ability {
	var abilities []Ability
	DB.Find(&abilities, "enabled = ?", true)
	return abilities
}

func getPriority(group string, model string, retry int) (int, error) {

	var priorities []int
	err := DB.Model(&Ability{}).
		Select("DISTINCT(priority)").
		Where(abilityGroupColumn()+" = ? and model = ? and enabled = ?", group, model, true).
		Order("priority DESC").              // 按优先级降序排序
		Pluck("priority", &priorities).Error // Pluck用于将查询的结果直接扫描到一个切片中

	if err != nil {
		// 处理错误
		return 0, err
	}

	if len(priorities) == 0 {
		// 如果没有查询到优先级，则返回错误
		return 0, errors.New("数据库一致性被破坏")
	}

	// 确定要使用的优先级
	var priorityToUse int
	if retry >= len(priorities) {
		// 如果重试次数大于优先级数，则使用最小的优先级
		priorityToUse = priorities[len(priorities)-1]
	} else {
		priorityToUse = priorities[retry]
	}
	return priorityToUse, nil
}

func getChannelQuery(group string, model string, retry int) (*gorm.DB, error) {
	maxPrioritySubQuery := DB.Model(&Ability{}).Select("MAX(priority)").Where(abilityGroupColumn()+" = ? and model = ? and enabled = ?", group, model, true)
	channelQuery := DB.Where(abilityGroupColumn()+" = ? and model = ? and enabled = ? and priority = (?)", group, model, true, maxPrioritySubQuery)
	if retry != 0 {
		priority, err := getPriority(group, model, retry)
		if err != nil {
			return nil, err
		} else {
			channelQuery = DB.Where(abilityGroupColumn()+" = ? and model = ? and enabled = ? and priority = ?", group, model, true, priority)
		}
	}

	return channelQuery, nil
}

func GetChannel(group string, model string, retry int, requestPath string, excludedChannelIDs map[int]struct{}) (*Channel, error) {
	return GetChannelWithFilter(group, model, retry, requestPath, excludedChannelIDs, ChannelProviderFilter{})
}

func GetChannelWithFilter(group string, model string, retry int, requestPath string, excludedChannelIDs map[int]struct{}, providerFilter ChannelProviderFilter) (*Channel, error) {
	var abilities []Ability
	query := DB.Where(abilityGroupColumn()+" = ? and model = ? and enabled = ?", group, model, true)
	if err := query.Order("priority DESC, weight DESC").Find(&abilities).Error; err != nil {
		return nil, err
	}
	if len(abilities) == 0 {
		normalizedModel := ratio_setting.FormatMatchingModelName(model)
		if normalizedModel != model {
			if err := DB.Where(abilityGroupColumn()+" = ? and model = ? and enabled = ?", group, normalizedModel, true).
				Order("priority DESC, weight DESC").Find(&abilities).Error; err != nil {
				return nil, err
			}
		}
	}
	abilities = filterAbilitiesByProvider(abilities, providerFilter)
	abilities = filterAbilitiesByRequestPathAndModel(abilities, requestPath, model)
	if len(abilities) == 0 {
		return nil, nil
	}
	if hub_routing_setting.IsServiceTier(group) {
		candidates := make([]hubTierChannelCandidate, 0, len(abilities))
		for _, ability := range abilities {
			providerID, eligible := hubTierProviderForChannel(ability.ChannelId, providerFilter)
			if !eligible {
				continue
			}
			priority := int64(0)
			if ability.Priority != nil {
				priority = *ability.Priority
			}
			candidates = append(candidates, hubTierChannelCandidate{
				ChannelID: ability.ChannelId,
				Priority:  priority,
				Weight:    int(ability.Weight),
				Provider:  providerID,
			})
		}
		channelID := selectHubTierChannel(candidates, excludedChannelIDs)
		if channelID == 0 {
			return nil, nil
		}
		channel := Channel{}
		if err := DB.First(&channel, "id = ? AND status = ?", channelID, common.ChannelStatusEnabled).Error; err != nil {
			if errors.Is(err, gorm.ErrRecordNotFound) {
				return nil, nil
			}
			return nil, err
		}
		return &channel, nil
	}

	priorities := make([]int64, 0)
	prioritySeen := make(map[int64]struct{})
	for _, ability := range abilities {
		priority := int64(0)
		if ability.Priority != nil {
			priority = *ability.Priority
		}
		if _, ok := prioritySeen[priority]; !ok {
			prioritySeen[priority] = struct{}{}
			priorities = append(priorities, priority)
		}
	}
	sort.Slice(priorities, func(i, j int) bool { return priorities[i] > priorities[j] })
	if retry >= len(priorities) {
		retry = len(priorities) - 1
	}
	targetPriority := priorities[retry]
	targetAbilities := make([]Ability, 0, len(abilities))
	for _, ability := range abilities {
		priority := int64(0)
		if ability.Priority != nil {
			priority = *ability.Priority
		}
		if priority == targetPriority {
			targetAbilities = append(targetAbilities, ability)
		}
	}
	abilities = preferUntriedAbilities(targetAbilities, excludedChannelIDs, providerFilter.StrictExcludedChannels)
	if len(abilities) == 0 {
		return nil, nil
	}
	channel := Channel{}
	weightSum := uint(0)
	for _, ability := range abilities {
		weightSum += ability.Weight + 10
	}
	weight := common.GetRandomInt(int(weightSum))
	for _, ability := range abilities {
		weight -= int(ability.Weight) + 10
		if weight <= 0 {
			channel.Id = ability.ChannelId
			break
		}
	}
	if err := DB.First(&channel, "id = ? AND status = ?", channel.Id, common.ChannelStatusEnabled).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, nil
		}
		return nil, err
	}
	return &channel, nil
}

func preferUntriedAbilities(abilities []Ability, excludedChannelIDs map[int]struct{}, strict bool) []Ability {
	if len(abilities) == 0 || len(excludedChannelIDs) == 0 {
		return abilities
	}
	filtered := make([]Ability, 0, len(abilities))
	for _, ability := range abilities {
		if _, excluded := excludedChannelIDs[ability.ChannelId]; !excluded {
			filtered = append(filtered, ability)
		}
	}
	if len(filtered) == 0 {
		if strict {
			return nil
		}
		return abilities
	}
	return filtered
}

func filterAbilitiesByProvider(abilities []Ability, providerFilter ChannelProviderFilter) []Ability {
	if len(abilities) == 0 || providerFilter.Mode == ChannelProviderAny || providerFilter.ProviderID <= 0 {
		return abilities
	}
	filtered := make([]Ability, 0, len(abilities))
	for _, ability := range abilities {
		if ChannelMatchesProviderFilter(ability.ChannelId, providerFilter) {
			filtered = append(filtered, ability)
		}
	}
	return filtered
}

// filterAbilitiesByRequestPathAndModel applies Hub probe-kind eligibility and
// Advanced Custom path rules to the DB (non-memory-cache) selection path.
func filterAbilitiesByRequestPathAndModel(abilities []Ability, requestPath string, model string) []Ability {
	if len(abilities) == 0 {
		return abilities
	}

	channelIds := make([]int, 0, len(abilities))
	seen := make(map[int]struct{}, len(abilities))
	for _, ability := range abilities {
		if _, ok := seen[ability.ChannelId]; ok {
			continue
		}
		seen[ability.ChannelId] = struct{}{}
		channelIds = append(channelIds, ability.ChannelId)
	}

	var channels []*Channel
	if err := DB.Where("id IN ?", channelIds).Find(&channels).Error; err != nil {
		// On error, fall back to unfiltered candidates to avoid blocking selection
		return abilities
	}
	supplyAvailability, err := loadHubSupplyChannelProbeKinds(DB, channelIds)
	if err != nil {
		return abilities
	}

	advancedConfigs := make(map[int]*dto.AdvancedCustomConfig)
	for _, channel := range channels {
		if channel.Type == constant.ChannelTypeAdvancedCustom {
			advancedConfigs[channel.Id] = channel.GetOtherSettings().AdvancedCustom
		}
	}

	filtered := make([]Ability, 0, len(abilities))
	for _, ability := range abilities {
		if !hubSupplyChannelSupportsRequest(supplyAvailability, ability.ChannelId, model, requestPath) {
			continue
		}
		config, isAdvancedCustom := advancedConfigs[ability.ChannelId]
		if !isAdvancedCustom {
			filtered = append(filtered, ability)
			continue
		}
		if requestPath == "" || config != nil && config.SupportsPathForModel(requestPath, model) {
			filtered = append(filtered, ability)
		}
	}
	return filtered
}

func (channel *Channel) AddAbilities(tx *gorm.DB) error {
	abilities, err := buildChannelAbilities(tx, channel)
	if err != nil {
		return err
	}
	if len(abilities) == 0 {
		return nil
	}
	// choose DB or provided tx
	useDB := DB
	if tx != nil {
		useDB = tx
	}
	for _, chunk := range lo.Chunk(abilities, 50) {
		err := useDB.Clauses(clause.OnConflict{DoNothing: true}).Create(&chunk).Error
		if err != nil {
			return err
		}
	}
	return nil
}

func buildChannelAbilities(tx *gorm.DB, channel *Channel) ([]Ability, error) {
	return buildChannelAbilitiesWithRoutingSetting(tx, channel, nil)
}

func buildChannelAbilitiesWithRoutingSetting(tx *gorm.DB, channel *Channel, routingSetting *hub_routing_setting.HubRoutingSetting) ([]Ability, error) {
	abilityModels, err := getHubSupplyChannelAbilityModels(tx, channel)
	if err != nil {
		return nil, err
	}
	query := DB
	if tx != nil {
		query = tx
	}
	var supplyGroup *HubSupplyGroup
	if channel != nil && channel.Id > 0 && query.Migrator().HasTable(&HubSupplyGroup{}) {
		var candidate HubSupplyGroup
		err := query.Where("new_api_channel_id = ?", channel.Id).First(&candidate).Error
		switch {
		case err == nil:
			supplyGroup = &candidate
		case errors.Is(err, gorm.ErrRecordNotFound):
		default:
			return nil, err
		}
	}

	defaultGroups := make([]string, 0)
	for _, group := range strings.Split(channel.Group, ",") {
		group = strings.TrimSpace(group)
		if group != "" {
			defaultGroups = append(defaultGroups, group)
		}
	}
	abilitySet := make(map[string]struct{})
	abilities := make([]Ability, 0, len(abilityModels))
	for _, modelName := range abilityModels {
		groups := defaultGroups
		if supplyGroup != nil {
			if _, _, priced := ratio_setting.GetModelRatioOrPrice(modelName); !priced {
				continue
			}
			family := ClassifyHubPublicModelFamily(modelName)
			groups = []string{HubTokenRoutingAbilityGroup}
			var serviceTiers []string
			if routingSetting == nil {
				serviceTiers = hub_routing_setting.ResolveEligibleServiceTiers(
					family,
					supplyGroup.PriceMultiplier,
					supplyGroup.ProviderId,
				)
			} else {
				serviceTiers = hub_routing_setting.ResolveEligibleServiceTiersWithSetting(
					*routingSetting,
					family,
					supplyGroup.PriceMultiplier,
					supplyGroup.ProviderId,
				)
			}
			groups = append(groups, serviceTiers...)
		}
		for _, group := range groups {
			key := group + "|" + modelName
			if _, exists := abilitySet[key]; exists {
				continue
			}
			abilitySet[key] = struct{}{}
			abilities = append(abilities, Ability{
				Group:     group,
				Model:     modelName,
				ChannelId: channel.Id,
				Enabled:   channel.Status == common.ChannelStatusEnabled,
				Priority:  channel.Priority,
				Weight:    uint(channel.GetWeight()),
				Tag:       channel.Tag,
			})
		}
	}
	return abilities, nil
}

func (channel *Channel) DeleteAbilities() error {
	return DB.Where("channel_id = ?", channel.Id).Delete(&Ability{}).Error
}

// UpdateAbilities updates abilities of this channel.
// Make sure the channel is completed before calling this function.
func (channel *Channel) UpdateAbilities(tx *gorm.DB) error {
	return channel.updateAbilitiesWithRoutingSetting(tx, nil)
}

func (channel *Channel) UpdateAbilitiesWithRoutingSetting(tx *gorm.DB, routingSetting *hub_routing_setting.HubRoutingSetting) error {
	return channel.updateAbilitiesWithRoutingSetting(tx, routingSetting)
}

func (channel *Channel) updateAbilitiesWithRoutingSetting(tx *gorm.DB, routingSetting *hub_routing_setting.HubRoutingSetting) error {
	isNewTx := false
	// 如果没有传入事务，创建新的事务
	if tx == nil {
		tx = DB.Begin()
		if tx.Error != nil {
			return tx.Error
		}
		isNewTx = true
		defer func() {
			if r := recover(); r != nil {
				tx.Rollback()
			}
		}()
	}

	// First delete all abilities of this channel
	err := tx.Where("channel_id = ?", channel.Id).Delete(&Ability{}).Error
	if err != nil {
		if isNewTx {
			tx.Rollback()
		}
		return err
	}

	// Then add new abilities
	abilities, err := buildChannelAbilitiesWithRoutingSetting(tx, channel, routingSetting)
	if err != nil {
		if isNewTx {
			tx.Rollback()
		}
		return err
	}

	if len(abilities) > 0 {
		for _, chunk := range lo.Chunk(abilities, 50) {
			err = tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&chunk).Error
			if err != nil {
				if isNewTx {
					tx.Rollback()
				}
				return err
			}
		}
	}

	// 如果是新创建的事务，需要提交
	if isNewTx {
		return tx.Commit().Error
	}

	return nil
}

func UpdateAbilityStatus(channelId int, status bool) error {
	return DB.Model(&Ability{}).Where("channel_id = ?", channelId).Select("enabled").Update("enabled", status).Error
}

func UpdateAbilityStatusByTag(tag string, status bool) error {
	return DB.Model(&Ability{}).Where("tag = ?", tag).Select("enabled").Update("enabled", status).Error
}

func UpdateAbilityByTag(tag string, newTag *string, priority *int64, weight *uint) error {
	ability := Ability{}
	if newTag != nil {
		ability.Tag = newTag
	}
	if priority != nil {
		ability.Priority = priority
	}
	if weight != nil {
		ability.Weight = *weight
	}
	return DB.Model(&Ability{}).Where("tag = ?", tag).Updates(ability).Error
}

var fixLock = sync.Mutex{}

var hubSupplyAbilityRefreshLock sync.Mutex

func RefreshHubSupplyAbilities() error {
	hubSupplyAbilityRefreshLock.Lock()
	defer hubSupplyAbilityRefreshLock.Unlock()
	routingSetting := hub_routing_setting.Snapshot()
	if err := refreshHubSupplyAbilitiesWithSetting(DB, &routingSetting); err != nil {
		return err
	}
	InitChannelCache()
	return nil
}

func refreshHubSupplyAbilitiesWithSetting(query *gorm.DB, routingSetting *hub_routing_setting.HubRoutingSetting) error {
	if query == nil {
		return nil
	}
	if !query.Migrator().HasTable(&HubSupplyGroup{}) {
		return nil
	}
	channelIDs := make([]int, 0)
	if err := query.Model(&HubSupplyGroup{}).Pluck("new_api_channel_id", &channelIDs).Error; err != nil {
		return err
	}
	if len(channelIDs) == 0 {
		return nil
	}
	var channels []*Channel
	if err := query.Where("id IN ?", channelIDs).Find(&channels).Error; err != nil {
		return err
	}
	update := func(tx *gorm.DB) error {
		for _, channel := range channels {
			if err := channel.UpdateAbilitiesWithRoutingSetting(tx, routingSetting); err != nil {
				return err
			}
		}
		return nil
	}
	if query == DB {
		return DB.Transaction(update)
	}
	return update(query)
}

func FixAbility() (int, int, error) {
	lock := fixLock.TryLock()
	if !lock {
		return 0, 0, errors.New("已经有一个修复任务在运行中，请稍后再试")
	}
	defer fixLock.Unlock()

	// truncate abilities table
	if common.UsingMainDatabase(common.DatabaseTypeSQLite) {
		err := DB.Exec("DELETE FROM abilities").Error
		if err != nil {
			common.SysLog(fmt.Sprintf("Delete abilities failed: %s", err.Error()))
			return 0, 0, err
		}
	} else {
		err := DB.Exec("TRUNCATE TABLE abilities").Error
		if err != nil {
			common.SysLog(fmt.Sprintf("Truncate abilities failed: %s", err.Error()))
			return 0, 0, err
		}
	}
	var channels []*Channel
	// Find all channels
	err := DB.Model(&Channel{}).Find(&channels).Error
	if err != nil {
		return 0, 0, err
	}
	if len(channels) == 0 {
		return 0, 0, nil
	}
	successCount := 0
	failCount := 0
	for _, chunk := range lo.Chunk(channels, 50) {
		ids := lo.Map(chunk, func(c *Channel, _ int) int { return c.Id })
		// Delete all abilities of this channel
		err = DB.Where("channel_id IN ?", ids).Delete(&Ability{}).Error
		if err != nil {
			common.SysLog(fmt.Sprintf("Delete abilities failed: %s", err.Error()))
			failCount += len(chunk)
			continue
		}
		// Then add new abilities
		for _, channel := range chunk {
			err = channel.AddAbilities(nil)
			if err != nil {
				common.SysLog(fmt.Sprintf("Add abilities for channel %d failed: %s", channel.Id, err.Error()))
				failCount++
			} else {
				successCount++
			}
		}
	}
	InitChannelCache()
	return successCount, failCount, nil
}
