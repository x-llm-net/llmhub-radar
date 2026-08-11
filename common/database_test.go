package common

import (
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func TestNormalizeSQLitePathAddsConcurrencySettings(t *testing.T) {
	dsn := normalizeSQLitePath(`C:\data\one-api.db`)
	base, rawQuery, found := strings.Cut(dsn, "?")
	require.True(t, found)
	assert.Equal(t, `C:\data\one-api.db`, base)

	query, err := url.ParseQuery(rawQuery)
	require.NoError(t, err)
	assert.Equal(t, "immediate", query.Get("_txlock"))
	assert.ElementsMatch(t, []string{
		"busy_timeout(30000)",
		"journal_mode(WAL)",
	}, query["_pragma"])
}

func TestNormalizeSQLitePathMigratesLegacyOptions(t *testing.T) {
	dsn := normalizeSQLitePath("one-api.db?_busy_timeout=7500&_journal_mode=DELETE&cache=shared")
	_, rawQuery, found := strings.Cut(dsn, "?")
	require.True(t, found)

	query, err := url.ParseQuery(rawQuery)
	require.NoError(t, err)
	assert.Equal(t, "shared", query.Get("cache"))
	assert.Empty(t, query.Get("_busy_timeout"))
	assert.Empty(t, query.Get("_journal_mode"))
	assert.ElementsMatch(t, []string{
		"busy_timeout(7500)",
		"journal_mode(DELETE)",
	}, query["_pragma"])
}

func TestNormalizeSQLitePathPreservesExplicitSettings(t *testing.T) {
	dsn := normalizeSQLitePath("one-api.db?_pragma=busy_timeout%281000%29&_pragma=journal_mode%28DELETE%29&_txlock=exclusive")
	_, rawQuery, found := strings.Cut(dsn, "?")
	require.True(t, found)

	query, err := url.ParseQuery(rawQuery)
	require.NoError(t, err)
	assert.Equal(t, "exclusive", query.Get("_txlock"))
	assert.ElementsMatch(t, []string{
		"busy_timeout(1000)",
		"journal_mode(DELETE)",
	}, query["_pragma"])
}

func TestNormalizeSQLitePathAppliesDriverPragmas(t *testing.T) {
	dsn := normalizeSQLitePath(filepath.Join(t.TempDir(), "driver.db"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	sqlDB, err := db.DB()
	require.NoError(t, err)
	defer sqlDB.Close()

	var journalMode string
	require.NoError(t, db.Raw("PRAGMA journal_mode").Scan(&journalMode).Error)
	assert.Equal(t, "wal", strings.ToLower(journalMode))

	var busyTimeout int
	require.NoError(t, db.Raw("PRAGMA busy_timeout").Scan(&busyTimeout).Error)
	assert.Equal(t, 30000, busyTimeout)
}
