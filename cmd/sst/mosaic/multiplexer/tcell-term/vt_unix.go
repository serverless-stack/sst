//go:build !windows
// +build !windows

package tcellterm

import "syscall"

func getPtyAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		Setsid: true,
		Setctty: true,
		Ctty: 1,
	}
}
