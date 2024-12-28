package server

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httputil"
	"net/rpc"
	"net/rpc/jsonrpc"
	"net/url"
	"os"
	"path/filepath"

	"github.com/sst/sst/v3/pkg/global"
	"github.com/sst/sst/v3/pkg/project"
	"github.com/sst/sst/v3/pkg/server/aws"
	"github.com/sst/sst/v3/pkg/server/resource"
	"github.com/sst/sst/v3/pkg/server/runtime"
	"github.com/sst/sst/v3/pkg/server/scrap"
)

type Server struct {
	Port int
	Mux  *http.ServeMux
	Rpc  *rpc.Server
}

func New() (*Server, error) {
	port, err := port()
	slog.Info("server port assigned", "port", port)
	if err != nil {
		return nil, err
	}
	result := &Server{
		Port: port,
		Mux:  http.NewServeMux(),
		Rpc:  rpc.NewServer(),
	}
	result.Mux.HandleFunc("/rpc", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		slog.Info("rpc request", "method", r.Method, "url", r.URL.String())
		result.Rpc.ServeCodec(jsonrpc.NewServerCodec(&HttpConn{Reader: r.Body, Writer: w}))
	})
	return result, nil
}

func (s *Server) Start(ctx context.Context, p *project.Project) error {
	defer slog.Info("server done")

	resource.Register(ctx, p, s.Rpc)
	aws.Register(ctx, p, s.Rpc)
	scrap.Register(ctx, p, s.Rpc)
	runtime.Register(ctx, p, s.Rpc)

	server := &http.Server{
		Handler: s.Mux,
	}
	server.Addr = fmt.Sprintf("0.0.0.0:%d", s.Port)
	slog.Info("server", "addr", server.Addr)
	serverPath := resolveServerFile(p.PathConfig(), p.App().Stage)
	u, _ := url.Parse("http://" + server.Addr)
	os.WriteFile(serverPath, []byte(u.String()), 0644)
	defer os.Remove(serverPath)
	go server.ListenAndServe()

	keyPath := filepath.Join(global.CertPath(), "key.pem")
	certPath := filepath.Join(global.CertPath(), "cert.pem")
	if _, err := os.Stat(keyPath); err == nil {
		slog.Info("https enabled")
		proxy := httputil.NewSingleHostReverseProxy(u)
		go http.ListenAndServeTLS(
			fmt.Sprintf("0.0.0.0:%d", s.Port+1000),
			certPath,
			keyPath,
			proxy,
		)
		if err != nil {
			slog.Error("failed to start https server", "err", err)
			return err
		}
	}

	<-ctx.Done()
	slog.Info("shutting down server")
	go server.Shutdown(ctx)
	return nil
}

func port() (int, error) {
	port := 13557
	for {
		if port == 65535 {
			return 0, fmt.Errorf("no port available")
		}
		listener, err := net.Listen("tcp", fmt.Sprintf("0.0.0.0:%d", port))
		if err != nil {
			port++
			continue
		}
		defer listener.Close()
		return port, nil
	}
}

type HttpConn struct {
	io.Reader
	io.Writer
}

func (c *HttpConn) Close() error { return nil }
