package model

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"

	"gorm.io/gorm"
)

// modelMetadataEndpointResolver is a read-only snapshot of the model metadata
// needed while one probe target set is reconciled. A single snapshot avoids a
// full models-table query for every configured model in a supply channel.
type modelMetadataEndpointResolver struct {
	metadata []Model
	err      error
}

func newModelMetadataEndpointResolver(tx *gorm.DB) *modelMetadataEndpointResolver {
	if tx == nil {
		return nil
	}
	// Some lightweight callers (and older installations during migration) may
	// reconcile supply targets before the optional model metadata table exists.
	// Preserve the legacy cache-backed behavior in that case; once the table is
	// present, query failures fail closed rather than reusing a stale union.
	if !tx.Migrator().HasTable(&Model{}) {
		return nil
	}
	resolver := &modelMetadataEndpointResolver{}
	if err := tx.Select("id", "model_name", "name_rule", "endpoints").
		Order("id ASC").Find(&resolver.metadata).Error; err != nil {
		// A metadata lookup failure must not fall back to the process-wide
		// endpoint union: that union can contain an image capability inferred
		// from a different channel. Fail closed for this concrete channel.
		resolver.err = err
	}
	return resolver
}

// endpointTypes resolves the explicit endpoint declaration for a concrete
// model name from the snapshot. The second element reports whether a usable
// canonical endpoint declaration (or a lookup failure) was found. Empty,
// malformed, and legacy array values are treated as unspecified metadata so
// they do not erase the channel adapter's normal capability.
func (resolver *modelMetadataEndpointResolver) endpointTypes(modelName string) ([]constant.EndpointType, bool) {
	modelName = strings.TrimSpace(modelName)
	if modelName == "" {
		return nil, false
	}
	if resolver == nil {
		return nil, false
	}
	if resolver.err != nil {
		return nil, true
	}

	var matched *Model
	// Existing pricing semantics are exact > prefix > suffix > contains.
	// NameRuleSuffix is numerically after contains, so use an explicit order.
	rules := []int{NameRuleExact, NameRulePrefix, NameRuleSuffix, NameRuleContains}
	for _, rule := range rules {
		for i := range resolver.metadata {
			candidate := &resolver.metadata[i]
			if candidate.NameRule != rule {
				continue
			}
			matches := false
			switch rule {
			case NameRuleExact:
				matches = candidate.ModelName == modelName
			case NameRulePrefix:
				matches = strings.HasPrefix(modelName, candidate.ModelName)
			case NameRuleSuffix:
				matches = strings.HasSuffix(modelName, candidate.ModelName)
			case NameRuleContains:
				matches = strings.Contains(modelName, candidate.ModelName)
			}
			if matches {
				matched = candidate
				break
			}
		}
		if matched != nil {
			break
		}
	}
	if matched == nil {
		return nil, false
	}

	return parseModelMetadataEndpointTypesWithDeclaration(matched.Endpoints)
}

// modelMetadataEndpointTypes resolves metadata directly for callers that do
// not already have a reconciliation snapshot.
func modelMetadataEndpointTypes(tx *gorm.DB, modelName string) ([]constant.EndpointType, bool) {
	if tx == nil {
		tx = DB
	}
	return newModelMetadataEndpointResolver(tx).endpointTypes(modelName)
}

// parseModelMetadataEndpointTypes accepts the endpoint object format used by
// the model metadata editor. Values may be a path string or an object carrying
// path/method fields; other JSON values are ignored just as pricing refresh
// ignores them. Endpoint names are returned in JSON decoder order-independent
// form and de-duplicated for callers that append them to adapter defaults.
func parseModelMetadataEndpointTypes(raw string) []constant.EndpointType {
	endpoints, _ := parseModelMetadataEndpointTypesWithDeclaration(raw)
	return endpoints
}

func parseModelMetadataEndpointTypesWithDeclaration(raw string) ([]constant.EndpointType, bool) {
	if strings.TrimSpace(raw) == "" {
		return nil, false
	}
	var endpoints map[string]interface{}
	if err := common.Unmarshal([]byte(raw), &endpoints); err != nil || endpoints == nil {
		return nil, false
	}
	result := make([]constant.EndpointType, 0, len(endpoints))
	seen := make(map[constant.EndpointType]struct{}, len(endpoints))
	for endpointName, value := range endpoints {
		switch value.(type) {
		case string, map[string]interface{}:
			endpoint := constant.EndpointType(strings.TrimSpace(endpointName))
			if endpoint == "" {
				continue
			}
			if _, exists := seen[endpoint]; exists {
				continue
			}
			seen[endpoint] = struct{}{}
			result = append(result, endpoint)
		}
	}
	return result, len(result) > 0
}

// NormalizeModelMetadataEndpoints is shared by official synchronization and
// keeps the database representation constrained to a JSON object. Empty,
// null, malformed, or non-object values are stored as an empty string.
func NormalizeModelMetadataEndpoints(raw json.RawMessage) string {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" || trimmed == "null" {
		return ""
	}
	var object map[string]interface{}
	if err := common.Unmarshal([]byte(trimmed), &object); err != nil || object == nil {
		return ""
	}
	encoded, err := common.Marshal(object)
	if err != nil {
		return ""
	}
	return string(encoded)
}

const (
	NameRuleExact = iota
	NameRulePrefix
	NameRuleContains
	NameRuleSuffix
)

type BoundChannel struct {
	Name string `json:"name"`
	Type int    `json:"type"`
}

type Model struct {
	Id           int            `json:"id"`
	ModelName    string         `json:"model_name" gorm:"size:128;not null;uniqueIndex:uk_model_name_delete_at,priority:1"`
	Description  string         `json:"description,omitempty" gorm:"type:text"`
	Icon         string         `json:"icon,omitempty" gorm:"type:varchar(128)"`
	Tags         string         `json:"tags,omitempty" gorm:"type:varchar(255)"`
	VendorID     int            `json:"vendor_id,omitempty" gorm:"index"`
	Endpoints    string         `json:"endpoints,omitempty" gorm:"type:text"`
	Status       int            `json:"status" gorm:"default:1"`
	SyncOfficial int            `json:"sync_official" gorm:"default:1"`
	CreatedTime  int64          `json:"created_time" gorm:"bigint"`
	UpdatedTime  int64          `json:"updated_time" gorm:"bigint"`
	DeletedAt    gorm.DeletedAt `json:"-" gorm:"index;uniqueIndex:uk_model_name_delete_at,priority:2"`

	BoundChannels []BoundChannel `json:"bound_channels,omitempty" gorm:"-"`
	EnableGroups  []string       `json:"enable_groups,omitempty" gorm:"-"`
	QuotaTypes    []int          `json:"quota_types,omitempty" gorm:"-"`
	// InferredEndpoints is populated for read-only API responses when the
	// persisted Endpoints declaration is empty. It is deliberately excluded
	// from GORM so inferred channel capabilities can never be written back as
	// model metadata by an edit form.
	InferredEndpoints string `json:"inferred_endpoints,omitempty" gorm:"-"`
	NameRule          int    `json:"name_rule" gorm:"default:0"`

	MatchedModels []string `json:"matched_models,omitempty" gorm:"-"`
	MatchedCount  int      `json:"matched_count,omitempty" gorm:"-"`
}

func (mi *Model) Insert() error {
	now := common.GetTimestamp()
	mi.CreatedTime = now
	mi.UpdatedTime = now

	// 保存原始值（因为 Create 后可能被 GORM 的 default 标签覆盖为 1）
	originalStatus := mi.Status
	originalSyncOfficial := mi.SyncOfficial

	// 先创建记录（GORM 会对零值字段应用默认值）
	if err := DB.Create(mi).Error; err != nil {
		return err
	}

	// 使用保存的原始值进行更新，确保零值能正确保存
	return DB.Model(&Model{}).Where("id = ?", mi.Id).Updates(map[string]interface{}{
		"status":        originalStatus,
		"sync_official": originalSyncOfficial,
	}).Error
}

func IsModelNameDuplicated(id int, name string) (bool, error) {
	if name == "" {
		return false, nil
	}
	var cnt int64
	err := DB.Model(&Model{}).Where("model_name = ? AND id <> ?", name, id).Count(&cnt).Error
	return cnt > 0, err
}

func (mi *Model) Update() error {
	mi.UpdatedTime = common.GetTimestamp()
	// 使用 Select 强制更新所有字段，包括零值
	return DB.Model(&Model{}).Where("id = ?", mi.Id).
		Select("model_name", "description", "icon", "tags", "vendor_id", "endpoints", "status", "sync_official", "name_rule", "updated_time").
		Updates(mi).Error
}

func (mi *Model) Delete() error {
	return DB.Delete(mi).Error
}

func GetVendorModelCounts() (map[int64]int64, error) {
	var stats []struct {
		VendorID int64
		Count    int64
	}
	if err := DB.Model(&Model{}).
		Select("vendor_id as vendor_id, count(*) as count").
		Group("vendor_id").
		Scan(&stats).Error; err != nil {
		return nil, err
	}
	m := make(map[int64]int64, len(stats))
	for _, s := range stats {
		m[s.VendorID] = s.Count
	}
	return m, nil
}

func GetAllModels(offset int, limit int) ([]*Model, error) {
	models, _, err := SearchModels("", "", "", "", offset, limit)
	return models, err
}

func GetBoundChannelsByModelsMap(modelNames []string) (map[string][]BoundChannel, error) {
	result := make(map[string][]BoundChannel)
	if len(modelNames) == 0 {
		return result, nil
	}
	type row struct {
		Model string
		Name  string
		Type  int
	}
	var rows []row
	err := DB.Table("channels").
		Select("abilities.model as model, channels.name as name, channels.type as type").
		Joins("JOIN abilities ON abilities.channel_id = channels.id").
		Where("abilities.model IN ? AND abilities.enabled = ?", modelNames, true).
		Distinct().
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	for _, r := range rows {
		result[r.Model] = append(result[r.Model], BoundChannel{Name: r.Name, Type: r.Type})
	}
	return result, nil
}

func normalizeLookupValues(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	normalized := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		normalized = append(normalized, value)
	}
	return normalized
}

func GetPreferredModelOwnerChannelTypes(modelNames []string, groups []string) (map[string]int, error) {
	result := make(map[string]int)
	modelNames = normalizeLookupValues(modelNames)
	if len(modelNames) == 0 {
		return result, nil
	}

	type row struct {
		Model       string
		ChannelType int
	}
	var rows []row

	query := DB.Table("abilities").
		Select("abilities.model as model, channels.type as channel_type").
		Joins("JOIN channels ON abilities.channel_id = channels.id").
		Where("abilities.model IN ? AND abilities.enabled = ? AND channels.status = ?", modelNames, true, common.ChannelStatusEnabled).
		Order("COALESCE(abilities.priority, 0) DESC").
		Order("abilities.weight DESC").
		Order("abilities.channel_id ASC")

	groups = normalizeLookupValues(groups)
	if len(groups) > 0 {
		query = query.Where("abilities."+commonGroupCol+" IN ?", groups)
	}

	if err := query.Scan(&rows).Error; err != nil {
		return nil, err
	}

	for _, r := range rows {
		if _, ok := result[r.Model]; ok {
			continue
		}
		result[r.Model] = r.ChannelType
	}
	return result, nil
}

func SearchModels(keyword string, vendor string, status string, syncOfficial string, offset int, limit int) ([]*Model, int64, error) {
	var models []*Model
	db := DB.Model(&Model{})
	if keyword != "" {
		like := "%" + keyword + "%"
		db = db.Where("model_name LIKE ? OR description LIKE ? OR tags LIKE ?", like, like, like)
	}
	if vendor != "" {
		if vid, err := strconv.Atoi(vendor); err == nil {
			db = db.Where("models.vendor_id = ?", vid)
		} else {
			db = db.Joins("JOIN vendors ON vendors.id = models.vendor_id").Where("vendors.name LIKE ?", "%"+vendor+"%")
		}
	}
	if statusValue, ok := parseModelStatusFilter(status); ok {
		db = db.Where("models.status = ?", statusValue)
	}
	if syncValue, ok := parseModelSyncFilter(syncOfficial); ok {
		db = db.Where("models.sync_official = ?", syncValue)
	}
	var total int64
	if err := db.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err := db.Order("models.id DESC").Offset(offset).Limit(limit).Find(&models).Error; err != nil {
		return nil, 0, err
	}
	return models, total, nil
}

// parseModelStatusFilter maps UI/API status values to the models.status column.
// Returns ok=false when no status filter should be applied.
func parseModelStatusFilter(status string) (value int, ok bool) {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "", "all":
		return 0, false
	case "enabled", "1":
		return 1, true
	case "disabled", "0":
		return 0, true
	default:
		n, err := strconv.Atoi(status)
		if err != nil {
			return 0, false
		}
		return n, true
	}
}

// parseModelSyncFilter maps UI/API sync values to the models.sync_official column.
// Returns ok=false when no sync filter should be applied.
func parseModelSyncFilter(syncOfficial string) (value int, ok bool) {
	switch strings.ToLower(strings.TrimSpace(syncOfficial)) {
	case "", "all":
		return 0, false
	case "yes", "1":
		return 1, true
	case "no", "0":
		return 0, true
	default:
		n, err := strconv.Atoi(syncOfficial)
		if err != nil {
			return 0, false
		}
		return n, true
	}
}
