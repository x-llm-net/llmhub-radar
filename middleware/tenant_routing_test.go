package middleware

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestTenantHostContextOnlySetsTrustedTenant(t *testing.T) {
	previousDB := model.DB
	previousType := common.MainDatabaseType()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Tenant{}, &model.TenantDomain{}))
	model.DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.DB = previousDB
		common.SetMainDatabaseType(previousType)
	})

	tenant := model.Tenant{Name: "Active tenant", Slug: "active-tenant", Status: model.TenantStatusActive}
	require.NoError(t, db.Create(&tenant).Error)
	require.NoError(t, db.Create(&model.TenantDomain{
		TenantId:           tenant.Id,
		Host:               "brand.example.com",
		VerificationStatus: model.TenantDomainVerificationVerified,
		Status:             model.TenantDomainStatusActive,
	}).Error)
	require.NoError(t, db.Create(&model.TenantDomain{
		TenantId:           tenant.Id,
		Host:               "pending.example.com",
		VerificationStatus: model.TenantDomainVerificationPending,
		Status:             model.TenantDomainStatusActive,
	}).Error)

	gin.SetMode(gin.TestMode)
	var capturedTenantIDs []int
	router := gin.New()
	router.Use(TenantHostContext())
	router.GET("/", func(c *gin.Context) {
		capturedTenantIDs = append(capturedTenantIDs, common.GetContextKeyInt(c, constant.ContextKeyTenantId))
		c.Status(http.StatusNoContent)
	})

	request := httptest.NewRequest(http.MethodGet, "https://brand.example.com/", nil)
	request.Host = "brand.example.com"
	response := httptest.NewRecorder()
	router.ServeHTTP(response, request)
	assert.Equal(t, http.StatusNoContent, response.Code)

	request = httptest.NewRequest(http.MethodGet, "https://pending.example.com/", nil)
	request.Host = "pending.example.com"
	response = httptest.NewRecorder()
	router.ServeHTTP(response, request)
	assert.Equal(t, http.StatusNoContent, response.Code)

	require.Len(t, capturedTenantIDs, 2)
	assert.Equal(t, tenant.Id, capturedTenantIDs[0])
	assert.Zero(t, capturedTenantIDs[1])
}

func TestTenantHostContextRequiredRejectsUntrustedHosts(t *testing.T) {
	previousDB := model.DB
	previousType := common.MainDatabaseType()
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	require.NoError(t, db.AutoMigrate(&model.Tenant{}, &model.TenantDomain{}))
	model.DB = db
	common.SetMainDatabaseType(common.DatabaseTypeSQLite)
	t.Cleanup(func() {
		model.DB = previousDB
		common.SetMainDatabaseType(previousType)
	})

	tenant := model.Tenant{Name: "Active tenant", Slug: "active-tenant", Status: model.TenantStatusActive}
	require.NoError(t, db.Create(&tenant).Error)
	require.NoError(t, db.Create(&model.TenantDomain{
		TenantId: tenant.Id, Host: "brand.example.com",
		VerificationStatus: model.TenantDomainVerificationVerified,
		Status:             model.TenantDomainStatusActive,
	}).Error)

	gin.SetMode(gin.TestMode)
	router := gin.New()
	router.GET("/", TenantHostContextRequired(), func(c *gin.Context) {
		c.Status(http.StatusNoContent)
	})

	for _, host := range []string{"brand.example.com", "unknown.example", "localhost:3000", "192.0.2.10"} {
		request := httptest.NewRequest(http.MethodGet, "https://"+host+"/", nil)
		request.Host = host
		response := httptest.NewRecorder()
		router.ServeHTTP(response, request)
		if host == "brand.example.com" {
			assert.Equal(t, http.StatusNoContent, response.Code, host)
		} else {
			assert.Equal(t, http.StatusNotFound, response.Code, host)
		}
	}
}
