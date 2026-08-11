package common

import (
	"net/url"
	"strings"
)

type DatabaseType string

const (
	DatabaseTypeMySQL      DatabaseType = "mysql"
	DatabaseTypeSQLite     DatabaseType = "sqlite"
	DatabaseTypePostgreSQL DatabaseType = "postgres"
	DatabaseTypeClickHouse DatabaseType = "clickhouse"
)

var mainDatabaseType = DatabaseTypeSQLite
var logDatabaseType = DatabaseTypeSQLite

func MainDatabaseType() DatabaseType {
	return mainDatabaseType
}

func LogDatabaseType() DatabaseType {
	return logDatabaseType
}

func SetMainDatabaseType(databaseType DatabaseType) {
	mainDatabaseType = databaseType
}

func SetLogDatabaseType(databaseType DatabaseType) {
	logDatabaseType = databaseType
}

func SetDatabaseTypes(mainType DatabaseType, logType DatabaseType) {
	mainDatabaseType = mainType
	logDatabaseType = logType
}

func UsingMainDatabase(databaseType DatabaseType) bool {
	return mainDatabaseType == databaseType
}

func UsingLogDatabase(databaseType DatabaseType) bool {
	return logDatabaseType == databaseType
}

var SQLitePath = normalizeSQLitePath("one-api.db")

func normalizeSQLitePath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" {
		path = "one-api.db"
	}

	base, rawQuery, _ := strings.Cut(path, "?")
	query, err := url.ParseQuery(rawQuery)
	if err != nil {
		return path
	}

	pragmas := query["_pragma"]
	hasBusyTimeout := false
	hasJournalMode := false
	for _, pragma := range pragmas {
		normalized := strings.ToLower(strings.ReplaceAll(strings.TrimSpace(pragma), " ", ""))
		if strings.HasPrefix(normalized, "busy_timeout(") || strings.HasPrefix(normalized, "busy_timeout=") {
			hasBusyTimeout = true
		}
		if strings.HasPrefix(normalized, "journal_mode(") || strings.HasPrefix(normalized, "journal_mode=") {
			hasJournalMode = true
		}
	}

	// modernc SQLite applies connection settings through repeated _pragma
	// parameters. Preserve legacy timeout values used by older deployments.
	if !hasBusyTimeout {
		timeout := strings.TrimSpace(query.Get("_busy_timeout"))
		if timeout == "" {
			timeout = "30000"
		}
		query.Add("_pragma", "busy_timeout("+timeout+")")
	}
	query.Del("_busy_timeout")

	if !hasJournalMode {
		journalMode := strings.TrimSpace(query.Get("_journal_mode"))
		if journalMode == "" {
			journalMode = "WAL"
		}
		query.Add("_pragma", "journal_mode("+journalMode+")")
	}
	query.Del("_journal_mode")

	if strings.TrimSpace(query.Get("_txlock")) == "" {
		query.Set("_txlock", "immediate")
	}

	return base + "?" + query.Encode()
}
