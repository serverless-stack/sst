//go:build !windows
// +build !windows

package monoplexer

import "syscall"

func getProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{
		Setpgid: true,
		Pgid:    0,
	}
}
