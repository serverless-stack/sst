package task

import "context"

func Run[T any](ctx context.Context, fn func() (T, error)) (T, error) {
	var result T
	var err error
	done := make(chan struct{})

	go func() {
		try := 0
		for {
			try++
			result, err = fn()
			if err == nil || try >= 3 {
				close(done)
				break
			}
		}
	}()

	select {
	case <-ctx.Done():
		return result, ctx.Err()
	case <-done:
		return result, err
	}
}
