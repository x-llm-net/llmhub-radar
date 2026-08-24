/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
package service

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func authSessionCookieForHost(t *testing.T, host string) *http.Cookie {
	t.Helper()
	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "https://"+host+"/", nil)
	request.Host = host
	c, _ := gin.CreateTestContext(recorder)
	c.Request = request
	WriteRefreshCookie(c, "refresh-token")
	cookies := recorder.Result().Cookies()
	require.Len(t, cookies, 1)
	return cookies[0]
}

func TestRefreshCookieDomainMatchesRequestHost(t *testing.T) {
	previousDomain := common.SessionCookieDomain
	previousSecure := common.SessionCookieSecure
	common.SessionCookieDomain = "llm-hub.store"
	common.SessionCookieSecure = true
	t.Cleanup(func() {
		common.SessionCookieDomain = previousDomain
		common.SessionCookieSecure = previousSecure
	})

	t.Run("platform subdomain shares cookie", func(t *testing.T) {
		cookie := authSessionCookieForHost(t, "app.llm-hub.store")
		assert.Equal(t, "llm-hub.store", cookie.Domain)
	})

	t.Run("custom domain uses host-only cookie", func(t *testing.T) {
		cookie := authSessionCookieForHost(t, "343246113.xyz")
		assert.Empty(t, cookie.Domain)
	})

	t.Run("port is ignored for local host matching", func(t *testing.T) {
		common.SessionCookieDomain = "localhost"
		cookie := authSessionCookieForHost(t, "localhost:3100")
		assert.Equal(t, "localhost", cookie.Domain)
	})
}
