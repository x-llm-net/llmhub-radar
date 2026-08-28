package router

import (
	"github.com/QuantumNous/new-api/controller"
	"github.com/QuantumNous/new-api/middleware"

	// Import oauth package to register providers via init()
	_ "github.com/QuantumNous/new-api/oauth"

	"github.com/gin-contrib/gzip"
	"github.com/gin-gonic/gin"
)

func SetApiRouter(router *gin.Engine) {
	apiRouter := router.Group("/api")
	apiRouter.Use(middleware.RouteTag("api"))
	apiRouter.Use(gzip.Gzip(gzip.DefaultCompression))
	apiRouter.Use(middleware.BodyStorageCleanup()) // 清理请求体存储
	apiRouter.Use(middleware.GlobalAPIRateLimit())
	anonymousRequestBodyLimit := middleware.AnonymousRequestBodyLimit()
	{
		apiRouter.GET("/setup", controller.GetSetup)
		apiRouter.POST("/setup", anonymousRequestBodyLimit, controller.PostSetup)
		apiRouter.GET("/status", controller.GetStatus)
		apiRouter.GET("/uptime/status", controller.GetUptimeKumaStatus)
		apiRouter.GET("/models", middleware.UserAuth(), controller.DashboardListModels)
		apiRouter.GET("/status/test", middleware.AdminAuth(), controller.TestStatus)
		apiRouter.GET("/notice", controller.GetNotice)
		apiRouter.GET("/user-agreement", controller.GetUserAgreement)
		apiRouter.GET("/privacy-policy", controller.GetPrivacyPolicy)
		apiRouter.GET("/about", controller.GetAbout)
		//apiRouter.GET("/midjourney", controller.GetMidjourney)
		apiRouter.GET("/home_page_content", controller.GetHomePageContent)
		apiRouter.GET("/hub/public/providers/:slug", controller.GetPublicHubProvider)
		apiRouter.GET("/hub/public/providers/:slug/logo", controller.GetPublicHubProviderLogo)
		apiRouter.GET("/hub/public/tls-ask", controller.AuthorizeHubPublicTLS)
		apiRouter.GET("/pricing", middleware.HeaderNavModuleAuth("pricing"), controller.GetPricing)
		perfMetricsRoute := apiRouter.Group("/perf-metrics")
		perfMetricsRoute.Use(middleware.HeaderNavModulePublicOrUserAuth("pricing"))
		{
			perfMetricsRoute.GET("/summary", controller.GetPerfMetricsSummary)
			perfMetricsRoute.GET("", controller.GetPerfMetrics)
		}
		apiRouter.GET("/rankings", middleware.HeaderNavModuleAuth("rankings"), controller.GetRankings)
		apiRouter.GET("/verification", middleware.EmailVerificationRateLimit(), middleware.TurnstileCheck(), controller.SendEmailVerification)
		apiRouter.GET("/reset_password", middleware.CriticalRateLimit(), middleware.TurnstileCheck(), controller.SendPasswordResetEmail)
		apiRouter.POST("/user/reset", middleware.CriticalRateLimit(), anonymousRequestBodyLimit, controller.ResetPassword)
		// OAuth routes - specific routes must come before :provider wildcard
		apiRouter.POST("/oauth/state", middleware.CriticalRateLimit(), middleware.DisableCache(), middleware.TryUserAuth(), anonymousRequestBodyLimit, controller.GenerateOAuthCode)
		apiRouter.POST("/oauth/email/bind", middleware.UserAuth(), middleware.CriticalRateLimit(), controller.EmailBind)
		// Non-standard OAuth (WeChat, Telegram) - keep original routes
		apiRouter.GET("/oauth/wechat", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.WeChatAuth)
		apiRouter.POST("/oauth/wechat/bind", middleware.UserAuth(), middleware.CriticalRateLimit(), controller.WeChatBind)
		apiRouter.GET("/oauth/telegram/login", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.TelegramLogin)
		apiRouter.POST("/oauth/telegram/bind/start", middleware.UserAuth(), middleware.CriticalRateLimit(), middleware.DisableCache(), controller.TelegramBindStart)
		apiRouter.GET("/oauth/telegram/bind/:flow_token", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.TelegramBind)
		// Standard OAuth providers (GitHub, Discord, OIDC, LinuxDO) - unified route
		apiRouter.GET("/oauth/:provider", middleware.CriticalRateLimit(), middleware.DisableCache(), middleware.TryUserAuth(), controller.HandleOAuth)
		apiRouter.GET("/ratio_config", middleware.CriticalRateLimit(), controller.GetRatioConfig)
		apiRouter.GET("/hub/public/home", controller.GetPublicHubHome)
		apiRouter.GET("/hub/public/brand", controller.GetPublicHubTenantBrand)
		apiRouter.GET("/hub/public/brand-assets/:asset_id", controller.GetPublicHubTenantBrandAsset)

		apiRouter.POST("/stripe/webhook", anonymousRequestBodyLimit, controller.StripeWebhook)
		apiRouter.POST("/creem/webhook", anonymousRequestBodyLimit, controller.CreemWebhook)
		apiRouter.POST("/waffo/webhook", anonymousRequestBodyLimit, controller.WaffoWebhook)
		// :env separates test vs prod URLs so the operator can register each
		// in Pancake's matching webhook slot; handler enforces env match.
		apiRouter.POST("/waffo-pancake/webhook/:env", anonymousRequestBodyLimit, controller.WaffoPancakeWebhook)

		// Universal secure verification routes
		apiRouter.POST("/verify", middleware.UserAuth(), middleware.CriticalRateLimit(), middleware.DisableCache(), controller.UniversalVerify)

		userRoute := apiRouter.Group("/user")
		{
			userRoute.POST("/auth/refresh", middleware.SessionCookieOriginGuard(), middleware.AuthRefreshRateLimit(), middleware.DisableCache(), controller.RefreshAuth)
			userRoute.POST("/auth/logout", middleware.SessionCookieOriginGuard(), middleware.CriticalRateLimit(), middleware.DisableCache(), controller.AuthLogout)
			userRoute.POST("/register", middleware.CriticalRateLimit(), anonymousRequestBodyLimit, middleware.TurnstileCheck(), controller.Register)
			userRoute.POST("/login", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, middleware.TurnstileCheck(), controller.Login)
			userRoute.POST("/login/2fa", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, controller.Verify2FALogin)
			userRoute.POST("/passkey/login/begin", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, controller.PasskeyLoginBegin)
			userRoute.POST("/passkey/login/finish", middleware.CriticalRateLimit(), middleware.DisableCache(), anonymousRequestBodyLimit, controller.PasskeyLoginFinish)
			//userRoute.POST("/tokenlog", middleware.CriticalRateLimit(), controller.TokenLog)
			userRoute.POST("/epay/notify", anonymousRequestBodyLimit, controller.EpayNotify)
			userRoute.GET("/epay/notify", controller.EpayNotify)
			userRoute.GET("/groups", controller.GetUserGroups)

			selfRoute := userRoute.Group("/")
			selfRoute.Use(middleware.UserAuth())
			{
				selfRoute.GET("/sessions", middleware.DisableCache(), controller.GetLoginSessions)
				selfRoute.DELETE("/sessions/:sid", middleware.DisableCache(), controller.DeleteLoginSession)
				selfRoute.POST("/sessions/revoke-others", middleware.DisableCache(), controller.RevokeOtherLoginSessions)
				selfRoute.GET("/self/groups", controller.GetUserGroups)
				selfRoute.GET("/self", controller.GetSelf)
				selfRoute.GET("/models", controller.GetUserModels)
				selfRoute.PUT("/self", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.UpdateSelf)
				selfRoute.DELETE("/self", controller.DeleteSelf)
				selfRoute.GET("/token", middleware.DisableCache(), controller.GenerateAccessToken)
				selfRoute.GET("/passkey", controller.PasskeyStatus)
				selfRoute.POST("/passkey/register/begin", middleware.DisableCache(), controller.PasskeyRegisterBegin)
				selfRoute.POST("/passkey/register/finish", middleware.DisableCache(), controller.PasskeyRegisterFinish)
				selfRoute.POST("/passkey/verify/begin", middleware.DisableCache(), controller.PasskeyVerifyBegin)
				selfRoute.POST("/passkey/verify/finish", middleware.DisableCache(), controller.PasskeyVerifyFinish)
				selfRoute.DELETE("/passkey", middleware.DisableCache(), controller.PasskeyDelete)
				selfRoute.GET("/aff", controller.GetAffCode)
				selfRoute.GET("/topup/info", controller.GetTopUpInfo)
				selfRoute.GET("/topup/self", controller.GetUserTopUps)
				selfRoute.POST("/topup", middleware.CriticalRateLimit(), controller.TopUp)
				selfRoute.POST("/pay", middleware.CriticalRateLimit(), controller.RequestEpay)
				selfRoute.POST("/amount", controller.RequestAmount)
				selfRoute.POST("/stripe/pay", middleware.CriticalRateLimit(), controller.RequestStripePay)
				selfRoute.POST("/stripe/amount", controller.RequestStripeAmount)
				selfRoute.POST("/creem/pay", middleware.CriticalRateLimit(), controller.RequestCreemPay)
				selfRoute.POST("/waffo/amount", controller.RequestWaffoAmount)
				selfRoute.POST("/waffo/pay", middleware.CriticalRateLimit(), controller.RequestWaffoPay)
				selfRoute.POST("/waffo-pancake/amount", controller.RequestWaffoPancakeAmount)
				selfRoute.POST("/waffo-pancake/pay", middleware.CriticalRateLimit(), controller.RequestWaffoPancakePay)
				selfRoute.POST("/aff_transfer", controller.TransferAffQuota)
				selfRoute.PUT("/setting", controller.UpdateUserSetting)

				// 2FA routes
				selfRoute.GET("/2fa/status", controller.Get2FAStatus)
				selfRoute.POST("/2fa/setup", middleware.DisableCache(), controller.Setup2FA)
				selfRoute.POST("/2fa/enable", middleware.DisableCache(), controller.Enable2FA)
				selfRoute.POST("/2fa/disable", middleware.DisableCache(), controller.Disable2FA)
				selfRoute.POST("/2fa/backup_codes", middleware.DisableCache(), controller.RegenerateBackupCodes)

				// Check-in routes
				selfRoute.GET("/checkin", controller.GetCheckinStatus)
				selfRoute.POST("/checkin", middleware.TurnstileCheck(), controller.DoCheckin)

				// Custom OAuth bindings
				selfRoute.GET("/oauth/bindings", controller.GetUserOAuthBindings)
				selfRoute.DELETE("/oauth/bindings/:provider_id", controller.UnbindCustomOAuth)
			}

			adminRoute := userRoute.Group("/")
			adminRoute.Use(middleware.AdminAuth())
			{
				adminRoute.GET("/", controller.GetAllUsers)
				adminRoute.GET("/topup", controller.GetAllTopUps)
				adminRoute.POST("/topup/complete", controller.AdminCompleteTopUp)
				adminRoute.GET("/search", controller.SearchUsers)
				adminRoute.GET("/:id/oauth/bindings", controller.GetUserOAuthBindingsByAdmin)
				adminRoute.DELETE("/:id/oauth/bindings/:provider_id", controller.UnbindCustomOAuthByAdmin)
				adminRoute.DELETE("/:id/bindings/:binding_type", controller.AdminClearUserBinding)
				adminRoute.GET("/:id", controller.GetUser)
				adminRoute.POST("/", controller.CreateUser)
				adminRoute.POST("/manage", controller.ManageUser)
				adminRoute.PUT("/", controller.UpdateUser)
				adminRoute.DELETE("/:id", controller.DeleteUser)
				adminRoute.DELETE("/:id/reset_passkey", controller.AdminResetPasskey)

				// Admin 2FA routes
				adminRoute.GET("/2fa/stats", controller.Admin2FAStats)
				adminRoute.DELETE("/:id/2fa", controller.AdminDisable2FA)
			}
		}

		hubProviderRoute := apiRouter.Group("/hub/provider")
		hubProviderRoute.Use(middleware.TenantHostContext(), middleware.UserAuth())
		{
			hubProviderRoute.GET("/self", controller.GetHubProviderSelf)
			hubProviderRoute.GET("/logo", controller.GetHubProviderLogo)
			hubProviderRoute.GET("/logs", controller.GetHubProviderLogs)
			hubProviderRoute.GET("/logs/stat", controller.GetHubProviderLogsStat)
			hubProviderRoute.POST("", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.CreateHubProvider)
			hubProviderRoute.PUT("", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.UpdateHubProviderProfile)
			hubProviderRoute.POST("/website-verification/assets", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.UploadHubProviderWebsiteEvidence)
			hubProviderRoute.GET("/website-verification/assets/:asset_id", middleware.DisableCache(), controller.GetHubProviderWebsiteEvidence)
			hubProviderRoute.POST("/website-verification", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.SubmitHubProviderWebsiteVerification)
			hubProviderRoute.POST("/website-verification/verify", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.VerifyHubProviderWebsite)
			hubProviderRoute.GET("/origins", controller.GetHubProviderOriginClaims)
			hubProviderRoute.POST("/origins", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.CreateHubProviderOriginClaim)
			hubProviderRoute.POST("/origins/:claim_id/verify", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.VerifyHubProviderOriginClaim)
			hubProviderRoute.DELETE("/origins/:claim_id", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.DeleteHubProviderOriginClaim)
			hubProviderRoute.GET("/channels", controller.GetHubProviderChannels)
			hubProviderRoute.GET("/channels/options/groups", controller.GetHubProviderChannelGroups)
			hubProviderRoute.GET("/channels/options/models", controller.ChannelListModels)
			hubProviderRoute.GET("/channels/options/prefill", controller.GetPrefillGroups)
			hubProviderRoute.POST("/channels/fetch-models", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.PreviewHubProviderChannelModels)
			hubProviderRoute.POST("/channels", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.CreateHubProviderChannel)
			hubProviderRoute.GET("/channels/:id", controller.GetHubProviderChannel)
			hubProviderRoute.PUT("/channels/:id", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.UpdateHubProviderChannel)
			hubProviderRoute.DELETE("/channels/:id", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.DeleteHubProviderChannel)
			hubProviderRoute.GET("/channels/:id/fetch-models", middleware.DisableCache(), controller.FetchHubProviderChannelModels)
			hubProviderRoute.GET("/channels/:id/probes", controller.GetHubProviderChannelProbes)
			hubProviderRoute.POST("/channels/:id/probe", middleware.HubSupplyProbeRateLimit(), middleware.DisableCache(), controller.RequestHubProviderChannelProbe)
			hubProviderRoute.POST("/channels/:id/probe-model", middleware.HubSupplyProbeRateLimit(), middleware.DisableCache(), controller.RequestHubProviderChannelModelProbe)
			hubProviderRoute.PUT("/channels/:id/probe-model-endpoint", middleware.HubSupplyProbeRateLimit(), middleware.DisableCache(), controller.UpdateHubProviderChannelModelProbeEndpoint)
			hubProviderRoute.PUT("/channels/:id/model-auto-probe", middleware.HubSupplyProbeRateLimit(), middleware.DisableCache(), controller.UpdateHubProviderChannelModelAutoProbe)
			hubProviderRoute.PUT("/channels/:id/model-publication", middleware.HubSupplyPublicationRateLimit(), middleware.DisableCache(), controller.UpdateHubProviderChannelModelPublication)
			hubProviderRoute.PUT("/channels/:id/model-publication/batch", middleware.HubSupplyPublicationRateLimit(), middleware.DisableCache(), controller.UpdateHubProviderChannelModelsPublication)
			hubProviderRoute.GET("/earnings/summary", controller.GetHubProviderEarningSummary)
			hubProviderRoute.GET("/earnings", controller.GetHubProviderEarnings)
			hubProviderRoute.POST("/earnings/balance-transfer", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.CreateHubProviderBalanceTransfer)
			hubProviderRoute.GET("/payout-accounts", controller.GetHubProviderPayoutAccounts)
			hubProviderRoute.POST("/payout-accounts", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.CreateHubProviderPayoutAccount)
			hubProviderRoute.PUT("/payout-accounts/:account_id", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.UpdateHubProviderPayoutAccount)
			hubProviderRoute.DELETE("/payout-accounts/:account_id", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.DeleteHubProviderPayoutAccount)
			hubProviderRoute.POST("/payout-assets", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.UploadHubProviderPayoutQRCode)
			hubProviderRoute.GET("/payout-assets/:asset_id", middleware.DisableCache(), controller.GetHubProviderPayoutAsset)
			hubProviderRoute.GET("/withdrawals", controller.GetHubProviderWithdrawals)
			hubProviderRoute.POST("/withdrawals", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.CreateHubProviderWithdrawal)
		}
		hubTenantFinanceRoute := apiRouter.Group("/hub/tenant")
		hubTenantFinanceRoute.Use(middleware.TenantHostContext(), middleware.TenantAdminAuth())
		{
			hubTenantFinanceRoute.GET("/earnings/summary", controller.GetHubTenantEarningSummary)
			hubTenantFinanceRoute.GET("/earnings", controller.GetHubTenantEarnings)
			hubTenantFinanceRoute.POST("/earnings/balance-transfer", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.CreateHubTenantBalanceTransfer)
			hubTenantFinanceRoute.GET("/payout-accounts", controller.GetHubTenantPayoutAccounts)
			hubTenantFinanceRoute.POST("/payout-accounts", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.CreateHubTenantPayoutAccount)
			hubTenantFinanceRoute.PUT("/payout-accounts/:account_id", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.UpdateHubTenantPayoutAccount)
			hubTenantFinanceRoute.DELETE("/payout-accounts/:account_id", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.DeleteHubTenantPayoutAccount)
			hubTenantFinanceRoute.POST("/payout-assets", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.UploadHubTenantPayoutQRCode)
			hubTenantFinanceRoute.GET("/payout-assets/:asset_id", middleware.DisableCache(), controller.GetHubTenantPayoutAsset)
			hubTenantFinanceRoute.GET("/withdrawals", controller.GetHubTenantWithdrawals)
			hubTenantFinanceRoute.POST("/withdrawals", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.CreateHubTenantWithdrawal)
		}
		hubProviderAdminRoute := apiRouter.Group("/hub/admin/providers")
		hubProviderAdminRoute.Use(middleware.TenantHostContext(), middleware.TenantAdminAuth())
		{
			hubProviderAdminRoute.GET("", controller.AdminListHubProviders)
			hubProviderAdminRoute.GET("/owner-candidates", controller.AdminListHubProviderOwnerCandidates)
			hubProviderAdminRoute.POST("", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.AdminCreateHubProvider)
			hubProviderAdminRoute.GET("/:id", controller.AdminGetHubProvider)
			hubProviderAdminRoute.GET("/:id/channels", controller.AdminGetHubProviderChannels)
			hubProviderAdminRoute.GET("/:id/logo", controller.GetAdminHubProviderLogo)
			hubProviderAdminRoute.GET("/withdrawals", controller.AdminGetHubProviderWithdrawals)
			hubProviderAdminRoute.PUT("/withdrawals/:withdrawal_id/status", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.AdminUpdateHubProviderWithdrawalStatus)
			hubProviderAdminRoute.GET("/tenant-withdrawals", controller.AdminGetHubTenantWithdrawals)
			hubProviderAdminRoute.GET("/tenant-payout-assets/:asset_id", middleware.DisableCache(), controller.AdminGetHubTenantPayoutAsset)
			hubProviderAdminRoute.PUT("/tenant-withdrawals/:withdrawal_id/status", middleware.RootAuth(), middleware.CriticalRateLimit(), middleware.DisableCache(), controller.AdminUpdateHubTenantWithdrawalStatus)
			hubProviderAdminRoute.GET("/:id/earnings/summary", controller.AdminGetHubProviderEarningSummary)
			hubProviderAdminRoute.GET("/:id/earnings", controller.AdminGetHubProviderEarnings)
			hubProviderAdminRoute.POST("/:id/earnings/adjustments", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.AdminCreateHubProviderEarningAdjustment)
			hubProviderAdminRoute.PUT("/:id/settlement-settings", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.AdminUpdateHubProviderSettlementSettings)
			hubProviderAdminRoute.PUT("/:id/status", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.AdminUpdateHubProviderStatus)
		}
		hubProviderOverviewRoute := apiRouter.Group("/hub/admin/provider-overview")
		hubProviderOverviewRoute.Use(middleware.RootAuth())
		{
			hubProviderOverviewRoute.GET("", controller.AdminListHubProviderOverview)
			hubProviderOverviewRoute.GET("/:id/logo", controller.GetAdminHubProviderOverviewLogo)
		}
		hubAdminRoute := apiRouter.Group("/hub/admin")
		hubAdminRoute.Use(middleware.TenantHostContext(), middleware.TenantAdminAuth())
		{
			hubAdminRoute.GET("/access", controller.GetHubAdminAccess)
			hubAdminRoute.GET("/brand", controller.GetCurrentHubTenantBrand)
			hubAdminRoute.PUT("/brand", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.UpdateCurrentHubTenantBrand)
			hubAdminRoute.GET("/routing-health", controller.AdminListHubRoutingHealth)
			hubAdminRoute.GET("/routing-metrics", controller.AdminListHubRoutingMetrics)
			hubAdminRoute.PUT("/channels/publication/batch", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.BatchUpdateHubChannelPublication)
			hubAdminRoute.PUT("/channels/:id/publication", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.UpdateHubChannelPublication)
		}
		hubAdminNotificationsRoute := apiRouter.Group("/hub/admin/notifications")
		{
			hubAdminNotificationsRoute.GET("", middleware.AdminAuth(), controller.ListHubAdminNotifications)
			hubAdminNotificationsRoute.GET("/settings", middleware.RootAuth(), controller.GetHubProviderNotificationSettings)
			hubAdminNotificationsRoute.PUT("/settings", middleware.RootAuth(), middleware.CriticalRateLimit(), middleware.DisableCache(), controller.UpdateHubProviderNotificationSettings)
			hubAdminNotificationsRoute.POST("/settings/test", middleware.RootAuth(), middleware.CriticalRateLimit(), middleware.DisableCache(), controller.TestHubProviderNotification)
		}
		hubTenantAdminRoute := apiRouter.Group("/hub/admin/tenants")
		hubTenantAdminRoute.Use(middleware.RootAuth())
		{
			hubTenantAdminRoute.GET("", controller.AdminListHubTenants)
			hubTenantAdminRoute.GET("/finance", controller.AdminListHubTenantSettlementSummaries)
			hubTenantAdminRoute.POST("", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.AdminCreateHubTenant)
			hubTenantAdminRoute.PUT("/:id/status", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.AdminUpdateHubTenantStatus)
			hubTenantAdminRoute.PUT("/:id/brand", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.AdminUpdateHubTenantBrand)
			hubTenantAdminRoute.POST("/:id/domains", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.AdminCreateHubTenantDomain)
			hubTenantAdminRoute.PUT("/:id/domains/:domain_id", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.AdminUpdateHubTenantDomain)
			hubTenantAdminRoute.POST("/:id/members", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.AdminUpsertHubTenantMember)
			hubTenantAdminRoute.PUT("/:id/members/:user_id", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.AdminUpdateHubTenantMember)
		}

		// Subscription billing (plans, purchase, admin management)
		subscriptionRoute := apiRouter.Group("/subscription")
		subscriptionRoute.Use(middleware.UserAuth())
		{
			subscriptionRoute.GET("/plans", controller.GetSubscriptionPlans)
			subscriptionRoute.GET("/self", controller.GetSubscriptionSelf)
			subscriptionRoute.PUT("/self/preference", controller.UpdateSubscriptionPreference)
			subscriptionRoute.POST("/balance/pay", middleware.CriticalRateLimit(), controller.SubscriptionRequestBalancePay)
			subscriptionRoute.POST("/epay/pay", middleware.CriticalRateLimit(), controller.SubscriptionRequestEpay)
			subscriptionRoute.POST("/stripe/pay", middleware.CriticalRateLimit(), controller.SubscriptionRequestStripePay)
			subscriptionRoute.POST("/creem/pay", middleware.CriticalRateLimit(), controller.SubscriptionRequestCreemPay)
			subscriptionRoute.POST("/waffo-pancake/pay", middleware.CriticalRateLimit(), controller.SubscriptionRequestWaffoPancakePay)
		}
		subscriptionAdminRoute := apiRouter.Group("/subscription/admin")
		subscriptionAdminRoute.Use(middleware.AdminAuth())
		{
			subscriptionAdminRoute.GET("/plans", controller.AdminListSubscriptionPlans)
			subscriptionAdminRoute.POST("/plans", controller.AdminCreateSubscriptionPlan)
			subscriptionAdminRoute.PUT("/plans/:id", controller.AdminUpdateSubscriptionPlan)
			subscriptionAdminRoute.PATCH("/plans/:id", controller.AdminUpdateSubscriptionPlanStatus)
			subscriptionAdminRoute.POST("/bind", controller.AdminBindSubscription)
			subscriptionAdminRoute.POST("/plans/:id/subscriptions/reset", controller.AdminResetPlanSubscriptions)

			// User subscription management (admin)
			subscriptionAdminRoute.GET("/users/:id/subscriptions", controller.AdminListUserSubscriptions)
			subscriptionAdminRoute.POST("/users/:id/subscriptions", controller.AdminCreateUserSubscription)
			subscriptionAdminRoute.POST("/users/:id/subscriptions/reset", controller.AdminResetUserSubscriptionsByPlan)
			subscriptionAdminRoute.POST("/user_subscriptions/:id/invalidate", controller.AdminInvalidateUserSubscription)
			subscriptionAdminRoute.DELETE("/user_subscriptions/:id", controller.AdminDeleteUserSubscription)
		}

		// Subscription payment callbacks (no auth)
		apiRouter.POST("/subscription/epay/notify", anonymousRequestBodyLimit, controller.SubscriptionEpayNotify)
		apiRouter.GET("/subscription/epay/notify", controller.SubscriptionEpayNotify)
		apiRouter.GET("/subscription/epay/return", controller.SubscriptionEpayReturn)
		apiRouter.POST("/subscription/epay/return", anonymousRequestBodyLimit, controller.SubscriptionEpayReturn)
		optionRoute := apiRouter.Group("/option")
		optionRoute.Use(middleware.RootAuth())
		{
			optionRoute.GET("/", controller.GetOptions)
			optionRoute.PUT("/hub-routing", controller.UpdateHubRoutingSetting)
			optionRoute.PUT("/hub-provider-settlement", controller.UpdateHubProviderSettlementSetting)
			optionRoute.PUT("/", controller.UpdateOption)
			optionRoute.POST("/payment_compliance", controller.ConfirmPaymentCompliance)
			optionRoute.GET("/channel_affinity_cache", controller.GetChannelAffinityCacheStats)
			optionRoute.DELETE("/channel_affinity_cache", controller.ClearChannelAffinityCache)
			optionRoute.POST("/rest_model_ratio", controller.ResetModelRatio)
			optionRoute.GET("/waffo-pancake/catalog", controller.ListWaffoPancakeCatalog)
			optionRoute.POST("/waffo-pancake/pair", controller.CreateWaffoPancakePair)
			optionRoute.POST("/waffo-pancake/save", controller.SaveWaffoPancake)
			optionRoute.POST("/waffo-pancake/subscription-product", controller.CreateWaffoPancakeSubscriptionProduct)
			optionRoute.GET("/waffo-pancake/subscription-product-options", controller.ListWaffoPancakeSubscriptionProductOptions)
		}

		// Custom OAuth provider management (root only)
		customOAuthRoute := apiRouter.Group("/custom-oauth-provider")
		customOAuthRoute.Use(middleware.RootAuth())
		{
			customOAuthRoute.POST("/discovery", controller.FetchCustomOAuthDiscovery)
			customOAuthRoute.GET("/", controller.GetCustomOAuthProviders)
			customOAuthRoute.GET("/:id", controller.GetCustomOAuthProvider)
			customOAuthRoute.POST("/", controller.CreateCustomOAuthProvider)
			customOAuthRoute.PUT("/:id", controller.UpdateCustomOAuthProvider)
			customOAuthRoute.DELETE("/:id", controller.DeleteCustomOAuthProvider)
		}
		performanceRoute := apiRouter.Group("/performance")
		performanceRoute.Use(middleware.RootAuth())
		{
			performanceRoute.GET("/stats", controller.GetPerformanceStats)
			performanceRoute.DELETE("/disk_cache", controller.ClearDiskCache)
			performanceRoute.POST("/reset_stats", controller.ResetPerformanceStats)
			performanceRoute.POST("/gc", controller.ForceGC)
			performanceRoute.GET("/logs", controller.GetLogFiles)
			performanceRoute.DELETE("/logs", controller.CleanupLogFiles)
		}
		ratioSyncRoute := apiRouter.Group("/ratio_sync")
		ratioSyncRoute.Use(middleware.RootAuth())
		{
			ratioSyncRoute.GET("/channels", controller.GetSyncableChannels)
			ratioSyncRoute.POST("/fetch", controller.FetchUpstreamRatios)
		}
		registerChannelRoutes(apiRouter)
		registerAuthzRoutes(apiRouter)
		tokenRoute := apiRouter.Group("/token")
		tokenRoute.Use(middleware.HubProviderRouting())
		tokenRoute.Use(middleware.UserAuth())
		{
			tokenRoute.GET("/", controller.GetAllTokens)
			tokenRoute.GET("/search", middleware.SearchRateLimit(), controller.SearchTokens)
			tokenRoute.GET("/auto-groups", controller.GetTokenAutoGroups)
			tokenRoute.GET("/routing-options", controller.GetHubTokenRoutingOptions)
			tokenRoute.GET("/:id", controller.GetToken)
			tokenRoute.POST("/:id/key", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.GetTokenKey)
			tokenRoute.POST("/", controller.AddToken)
			tokenRoute.PUT("/", controller.UpdateToken)
			tokenRoute.DELETE("/:id", controller.DeleteToken)
			tokenRoute.POST("/batch", controller.DeleteTokenBatch)
			tokenRoute.POST("/batch/keys", middleware.CriticalRateLimit(), middleware.DisableCache(), controller.GetTokenKeysBatch)
		}

		usageRoute := apiRouter.Group("/usage")
		usageRoute.Use(middleware.CORS(), middleware.CriticalRateLimit())
		{
			tokenUsageRoute := usageRoute.Group("/token")
			tokenUsageRoute.Use(middleware.TokenAuthReadOnly())
			{
				tokenUsageRoute.GET("/", controller.GetTokenUsage)
			}
		}

		redemptionRoute := apiRouter.Group("/redemption")
		redemptionRoute.Use(middleware.AdminAuth())
		{
			redemptionRoute.GET("/", controller.GetAllRedemptions)
			redemptionRoute.GET("/search", controller.SearchRedemptions)
			redemptionRoute.GET("/:id", controller.GetRedemption)
			redemptionRoute.POST("/", controller.AddRedemption)
			redemptionRoute.PUT("/", controller.UpdateRedemption)
			redemptionRoute.DELETE("/invalid", controller.DeleteInvalidRedemption)
			redemptionRoute.DELETE("/:id", controller.DeleteRedemption)
		}
		logRoute := apiRouter.Group("/log")
		logRoute.GET("/", middleware.TenantHostContext(), middleware.TenantAdminAuth(), controller.GetAllLogs)
		logRoute.GET("/stat", middleware.TenantHostContext(), middleware.TenantAdminAuth(), controller.GetLogsStat)
		logRoute.GET("/self/stat", middleware.UserAuth(), controller.GetLogsSelfStat)
		logRoute.GET("/channel_affinity_usage_cache", middleware.AdminAuth(), controller.GetChannelAffinityUsageCacheStats)
		logRoute.GET("/search", middleware.AdminAuth(), controller.SearchAllLogs)
		logRoute.GET("/self", middleware.UserAuth(), controller.GetUserLogs)
		logRoute.GET("/self/search", middleware.UserAuth(), middleware.SearchRateLimit(), controller.SearchUserLogs)

		systemTaskRoute := apiRouter.Group("/system-task")
		systemTaskRoute.Use(middleware.RootAuth())
		{
			systemTaskRoute.POST("/log-cleanup", controller.CreateLogCleanupSystemTask)
			systemTaskRoute.GET("/list", controller.ListSystemTasks)
			systemTaskRoute.GET("/current", controller.GetCurrentSystemTask)
			systemTaskRoute.GET("/:task_id", controller.GetSystemTask)
		}
		systemInfoRoute := apiRouter.Group("/system-info")
		systemInfoRoute.Use(middleware.RootAuth())
		{
			systemInfoRoute.GET("/instances", controller.ListSystemInstances)
			systemInfoRoute.DELETE("/stale-instances", controller.DeleteStaleSystemInstances)
			systemInfoRoute.DELETE("/instances/:node_name", controller.DeleteStaleSystemInstance)
		}

		dataRoute := apiRouter.Group("/data")
		dataRoute.GET("/", middleware.AdminAuth(), controller.GetAllQuotaDates)
		dataRoute.GET("/users", middleware.AdminAuth(), controller.GetQuotaDatesByUser)
		dataRoute.GET("/self", middleware.UserAuth(), controller.GetUserQuotaDates)
		dataRoute.GET("/flow", middleware.AdminAuth(), controller.GetAllFlowQuotaDates)
		dataRoute.GET("/flow/self", middleware.UserAuth(), controller.GetUserFlowQuotaDates)

		logRoute.Use(middleware.CORS(), middleware.CriticalRateLimit())
		{
			logRoute.GET("/token", middleware.TokenAuthReadOnly(), controller.GetLogByKey)
		}
		groupRoute := apiRouter.Group("/group")
		groupRoute.Use(middleware.AdminAuth())
		{
			groupRoute.GET("/", controller.GetGroups)
		}

		prefillGroupRoute := apiRouter.Group("/prefill_group")
		prefillGroupRoute.Use(middleware.AdminAuth())
		{
			prefillGroupRoute.GET("/", controller.GetPrefillGroups)
			prefillGroupRoute.POST("/", controller.CreatePrefillGroup)
			prefillGroupRoute.PUT("/", controller.UpdatePrefillGroup)
			prefillGroupRoute.DELETE("/:id", controller.DeletePrefillGroup)
		}

		mjRoute := apiRouter.Group("/mj")
		mjRoute.GET("/self", middleware.UserAuth(), controller.GetUserMidjourney)
		mjRoute.GET("/", middleware.AdminAuth(), controller.GetAllMidjourney)

		taskRoute := apiRouter.Group("/task")
		{
			taskRoute.GET("/self", middleware.UserAuth(), controller.GetUserTask)
			taskRoute.GET("/", middleware.AdminAuth(), controller.GetAllTask)
		}

		vendorRoute := apiRouter.Group("/vendors")
		vendorRoute.Use(middleware.AdminAuth())
		{
			vendorRoute.GET("/", controller.GetAllVendors)
			vendorRoute.GET("/search", controller.SearchVendors)
			vendorRoute.GET("/:id", controller.GetVendorMeta)
			vendorRoute.POST("/", controller.CreateVendorMeta)
			vendorRoute.PUT("/", controller.UpdateVendorMeta)
			vendorRoute.DELETE("/:id", controller.DeleteVendorMeta)
		}

		modelsRoute := apiRouter.Group("/models")
		modelsRoute.Use(middleware.AdminAuth())
		{
			modelsRoute.GET("/sync_upstream/preview", controller.SyncUpstreamPreview)
			modelsRoute.POST("/sync_upstream", controller.SyncUpstreamModels)
			modelsRoute.GET("/missing", controller.GetMissingModels)
			modelsRoute.GET("/", controller.GetAllModelsMeta)
			modelsRoute.GET("/search", controller.SearchModelsMeta)
			modelsRoute.GET("/:id", controller.GetModelMeta)
			modelsRoute.POST("/", controller.CreateModelMeta)
			modelsRoute.PUT("/", controller.UpdateModelMeta)
			modelsRoute.DELETE("/:id", controller.DeleteModelMeta)
		}

		// Deployments (model deployment management)
		deploymentsRoute := apiRouter.Group("/deployments")
		deploymentsRoute.Use(middleware.AdminAuth())
		{
			deploymentsRoute.GET("/settings", controller.GetModelDeploymentSettings)
			deploymentsRoute.POST("/settings/test-connection", controller.TestIoNetConnection)
			deploymentsRoute.GET("/", controller.GetAllDeployments)
			deploymentsRoute.GET("/search", controller.SearchDeployments)
			deploymentsRoute.POST("/test-connection", controller.TestIoNetConnection)
			deploymentsRoute.GET("/hardware-types", controller.GetHardwareTypes)
			deploymentsRoute.GET("/locations", controller.GetLocations)
			deploymentsRoute.GET("/available-replicas", controller.GetAvailableReplicas)
			deploymentsRoute.POST("/price-estimation", controller.GetPriceEstimation)
			deploymentsRoute.GET("/check-name", controller.CheckClusterNameAvailability)
			deploymentsRoute.POST("/", controller.CreateDeployment)

			deploymentsRoute.GET("/:id", controller.GetDeployment)
			deploymentsRoute.GET("/:id/logs", controller.GetDeploymentLogs)
			deploymentsRoute.GET("/:id/containers", controller.ListDeploymentContainers)
			deploymentsRoute.GET("/:id/containers/:container_id", controller.GetContainerDetails)
			deploymentsRoute.PUT("/:id", controller.UpdateDeployment)
			deploymentsRoute.PUT("/:id/name", controller.UpdateDeploymentName)
			deploymentsRoute.POST("/:id/extend", controller.ExtendDeployment)
			deploymentsRoute.DELETE("/:id", controller.DeleteDeployment)
		}
	}
}
