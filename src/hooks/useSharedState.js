import { useEffect, useState } from 'react'
import { loadJSON, loadString, saveJSON, saveString } from '../lib/format'

const identity = (value) => value

export function useSharedJSON(key, fallback, normalize = identity) {
  const [value, setValue] = useState(() => normalize(loadJSON(key, fallback)))

  useEffect(() => {
    saveJSON(key, value)
  }, [key, value])

  useEffect(() => {
    const handler = (event) => {
      if (event.key !== key || event.newValue == null) return
      try {
        setValue(normalize(JSON.parse(event.newValue)))
      } catch {
        // 忽略其他窗口写入的损坏数据
      }
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [key, normalize])

  return [value, setValue]
}

export function useSharedString(key, fallback) {
  const [value, setValue] = useState(() => loadString(key, fallback))

  useEffect(() => {
    saveString(key, value)
  }, [key, value])

  useEffect(() => {
    const handler = (event) => {
      if (event.key !== key || event.newValue == null) return
      setValue(event.newValue)
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [key])

  return [value, setValue]
}
