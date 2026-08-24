package model

import (
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestFilterAbilitiesByRequestPathAndModelFailsClosedOnEligibilityQueryError(t *testing.T) {
	previousDB := DB
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	require.NoError(t, err)
	DB = db
	t.Cleanup(func() { DB = previousDB })

	abilities := []Ability{{Group: "hub-routing", Model: "gpt-5", ChannelId: 42, Enabled: true}}
	filtered, err := filterAbilitiesByRequestPathAndModel(abilities, "/v1/responses", "gpt-5")

	assert.Error(t, err)
	assert.Empty(t, filtered)
}
