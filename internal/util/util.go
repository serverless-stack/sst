package util

import (
	"crypto/rand"
	"sync"
)

func RandomString(length int) string {
	const charset = "abcdefhkmnorstuvwxz"
	b := make([]byte, length)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	for i := range b {
		b[i] = charset[b[i]%byte(len(charset))]
	}
	return string(b)
}

type ReadableError struct {
	message string
	error   error
	hinted  bool
}

func NewReadableError(err error, message string) *ReadableError {
	return &ReadableError{message: message, error: err}
}

func NewHintedError(err error, message string) *ReadableError {
	return &ReadableError{message: message, error: err, hinted: true}
}

func (e *ReadableError) Error() string {
	return e.message
}

func (e *ReadableError) Unwrap() error {
	return e.error
}

func (e *ReadableError) IsHinted() bool {
	return e.hinted
}

type CleanupFunc func() error

type KeyLock struct {
	locks map[string]chan struct{}
	mu    sync.Mutex
}

func NewKeyLock() *KeyLock {
	return &KeyLock{
		locks: make(map[string]chan struct{}),
	}
}

func (kl *KeyLock) Lock(key string) {
	kl.mu.Lock()
	if _, ok := kl.locks[key]; !ok {
		kl.locks[key] = make(chan struct{}, 1)
		kl.locks[key] <- struct{}{}
	}
	lock := kl.locks[key]
	kl.mu.Unlock()

	<-lock
}

func (kl *KeyLock) Unlock(key string) {
	kl.mu.Lock()
	if lock, ok := kl.locks[key]; ok {
		lock <- struct{}{}
	}
	kl.mu.Unlock()
}

type SyncMap[K comparable, V any] struct {
	m sync.Map
}

func (m *SyncMap[K, V]) Delete(key K) { m.m.Delete(key) }
func (m *SyncMap[K, V]) Load(key K) (value V, ok bool) {
	v, ok := m.m.Load(key)
	if !ok {
		return value, ok
	}
	return v.(V), ok
}
func (m *SyncMap[K, V]) LoadAndDelete(key K) (value V, loaded bool) {
	v, loaded := m.m.LoadAndDelete(key)
	if !loaded {
		return value, loaded
	}
	return v.(V), loaded
}
func (m *SyncMap[K, V]) LoadOrStore(key K, value V) (actual V, loaded bool) {
	a, loaded := m.m.LoadOrStore(key, value)
	return a.(V), loaded
}
func (m *SyncMap[K, V]) Range(f func(key K, value V) bool) {
	m.m.Range(func(key, value any) bool { return f(key.(K), value.(V)) })
}
func (m *SyncMap[K, V]) Store(key K, value V) { m.m.Store(key, value) }
