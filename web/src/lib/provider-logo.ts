/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.
*/
import { useEffect, useState } from 'react'

import { api } from '@/lib/http-client'

export function useProviderLogoURL(source?: string): string {
  const [resolvedURL, setResolvedURL] = useState('')

  useEffect(() => {
    if (!source || !source.startsWith('/api/hub/')) {
      setResolvedURL(source || '')
      return
    }

    let disposed = false
    let objectURL = ''
    setResolvedURL('')

    void api
      .get<Blob>(source, {
        responseType: 'blob',
        skipErrorHandler: true,
      })
      .then((response) => {
        if (disposed) return
        objectURL = URL.createObjectURL(response.data)
        setResolvedURL(objectURL)
      })
      .catch(() => {
        if (!disposed) setResolvedURL('')
      })

    return () => {
      disposed = true
      if (objectURL) URL.revokeObjectURL(objectURL)
    }
  }, [source])

  return resolvedURL
}
