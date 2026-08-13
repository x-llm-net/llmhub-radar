/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'

import { getProviderApplicationState } from '../application-state.ts'

describe('provider application state presentation', () => {
  test('pending applications cannot access earnings or review details', () => {
    const state = getProviderApplicationState('pending')

    assert.equal(state.label, 'Pending review')
    assert.equal(state.showRemark, false)
    assert.equal(state.showEarnings, false)
  })

  test('rejected applications expose the review reason for resubmission', () => {
    const state = getProviderApplicationState('rejected')

    assert.equal(state.remarkLabel, 'Review reason')
    assert.equal(state.showRemark, true)
    assert.equal(state.editLabel, 'Edit application')
  })

  test('disabled providers retain earnings access without the workspace', () => {
    const state = getProviderApplicationState('disabled')

    assert.equal(state.showEarnings, true)
    assert.equal(state.editLabel, 'Edit public profile')
  })
})
