package hub_provider_settlement_setting

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateOption(t *testing.T) {
	assert.Equal(t, 3000, DefaultPlatformFeeBasisPoints)
	require.NoError(t, ValidateOption(OptionKeyPlatformFeeBasisPoints, "0"))
	require.NoError(t, ValidateOption(OptionKeyPlatformFeeBasisPoints, "10000"))
	assert.Error(t, ValidateOption(OptionKeyPlatformFeeBasisPoints, "10001"))
	assert.Error(t, ValidateOption(OptionKeyMinimumWithdrawalQuota, "-1"))
	require.NoError(t, ValidateOption(OptionKeyMinimumWithdrawalQuota, "500000"))
	require.NoError(t, ValidateOption(OptionKeyFallbackReferralEnabled, "true"))
	require.NoError(t, ValidateOption(OptionKeyFallbackReferralEnabled, "false"))
	assert.Error(t, ValidateOption(OptionKeyFallbackReferralEnabled, "enabled"))
	require.NoError(t, ValidateOption(OptionKeyFallbackReferralBasisPoints, "100"))
	assert.Error(t, ValidateOption(OptionKeyFallbackReferralBasisPoints, "10001"))
}
