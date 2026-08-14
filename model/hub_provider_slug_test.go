/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
*/
package model

import "testing"

func TestHubProviderSlugFromWebsite(t *testing.T) {
	tests := []struct {
		name    string
		website string
		want    string
	}{
		{name: "root domain", website: "https://x-llm.net", want: "x-llm"},
		{name: "www root domain", website: "https://www.skyhope.com", want: "skyhope"},
		{name: "nested host", website: "https://api.skyhope.com/v1", want: "skyhope"},
		{name: "two level suffix", website: "https://skyhope.co.uk", want: "skyhope"},
		{name: "invalid website", website: "not a url", want: ""},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := hubProviderSlugFromWebsite(test.website); got != test.want {
				t.Fatalf("hubProviderSlugFromWebsite(%q) = %q, want %q", test.website, got, test.want)
			}
		})
	}
}
