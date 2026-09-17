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
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCurrentHubWeeklyDigestPayloadUsesBeijingNaturalWeek(t *testing.T) {
	location, err := time.LoadLocation("Asia/Shanghai")
	require.NoError(t, err)

	_, due := CurrentHubWeeklyDigestPayload(time.Date(2026, 9, 21, 9, 29, 59, 0, location))
	assert.False(t, due)

	payload, due := CurrentHubWeeklyDigestPayload(time.Date(2026, 9, 21, 9, 30, 0, 0, location))
	require.True(t, due)
	assert.Equal(t, time.Date(2026, 9, 14, 0, 0, 0, 0, location).Unix(), payload.WeekStart)
	assert.Equal(t, time.Date(2026, 9, 21, 0, 0, 0, 0, location).Unix(), payload.WeekEnd)

	catchUp, due := CurrentHubWeeklyDigestPayload(time.Date(2026, 9, 27, 23, 0, 0, 0, location))
	require.True(t, due)
	assert.Equal(t, payload, catchUp)
}
