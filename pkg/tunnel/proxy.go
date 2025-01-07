package tunnel

import (
	"context"
	"fmt"
	"net"

	"github.com/armon/go-socks5"
	"github.com/sst/sst/v3/cmd/sst/mosaic/ui"
	"golang.org/x/crypto/ssh"
)

func StartProxy(ctx context.Context, username string, host string, key []byte) error {
	signer, err := ssh.ParsePrivateKey(key)
	if err != nil {
		return err
	}
	config := &ssh.ClientConfig{
		User: username,
		Auth: []ssh.AuthMethod{
			ssh.PublicKeys(signer),
		},
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
	}
	sshClient, err := ssh.Dial("tcp", host, config)
	if err != nil {
		return err
	}
	defer sshClient.Close()
	server, err := socks5.New(&socks5.Config{
		Dial: func(ctx context.Context, network, addr string) (net.Conn, error) {
			fmt.Println(ui.TEXT_INFO_BOLD.Render(("| "), ui.TEXT_NORMAL.Render("Tunneling", network, addr)))
			return sshClient.Dial(network, addr)
		},
	})
	if err != nil {
		return err
	}
	errChan := make(chan error, 1)
	go func() {
		errChan <- server.ListenAndServe("tcp", fmt.Sprintf("%s:%d", "127.0.0.1", 1080))
	}()
	select {
	case err := <-errChan:
		return err
	case <-ctx.Done():
		return nil
	}
}
