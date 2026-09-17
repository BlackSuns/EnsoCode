package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"
)

//go:embed all:frontend
var frontendFS embed.FS

var version = "dev"

func main() {
	os.Exit(run(os.Args[1:]))
}

func run(args []string) int {
	flags := flag.NewFlagSet("enso-relay", flag.ContinueOnError)
	flags.SetOutput(os.Stderr)
	listen := flags.String("listen", envOr("RELAY_LISTEN", ":8787"), "监听地址")
	dbPath := flags.String("db", envOr("RELAY_DB", ""), "SQLite 路径（默认：可执行文件旁边的 relay.sqlite）")
	tlsCert := flags.String("tls-cert", envOr("RELAY_TLS_CERT", ""), "可选 TLS 证书")
	tlsKey := flags.String("tls-key", envOr("RELAY_TLS_KEY", ""), "可选 TLS 私钥")
	showVersion := flags.Bool("version", false, "打印版本")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if *showVersion {
		fmt.Println(version)
		return 0
	}

	log := slog.New(slog.NewTextHandler(os.Stdout, nil))
	if *dbPath == "" {
		*dbPath = defaultDBPath()
	}
	if err := os.MkdirAll(filepath.Dir(*dbPath), 0o755); err != nil && filepath.Dir(*dbPath) != "." {
		log.Error("create db dir", "err", err)
		return 1
	}

	store, err := openStore(*dbPath)
	if err != nil {
		log.Error("open sqlite", "path", *dbPath, "err", err)
		return 1
	}
	defer store.close()

	static, err := fs.Sub(frontendFS, "frontend")
	if err != nil {
		log.Error("embed frontend", "err", err)
		return 1
	}

	srv := &http.Server{
		Addr:              *listen,
		Handler:           newServer(store, static, log),
		ReadHeaderTimeout: 10 * time.Second,
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(shutdownCtx)
	}()

	scheme := "http"
	if *tlsCert != "" && *tlsKey != "" {
		scheme = "https"
	}
	ln, err := net.Listen("tcp", *listen)
	if err != nil {
		log.Error("listen", "addr", *listen, "err", err)
		return 1
	}
	printBanner(scheme, ln.Addr().String(), *dbPath)

	var serveErr error
	if scheme == "https" {
		serveErr = srv.ServeTLS(ln, *tlsCert, *tlsKey)
	} else {
		serveErr = srv.Serve(ln)
	}
	if serveErr != nil && serveErr != http.ErrServerClosed {
		log.Error("serve", "err", serveErr)
		return 1
	}
	return 0
}

func envOr(key, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return fallback
}

func defaultDBPath() string {
	exe, err := os.Executable()
	if err != nil {
		return "relay.sqlite"
	}
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	dir := filepath.Dir(exe)
	base := strings.ToLower(filepath.Base(dir))
	if strings.Contains(base, "go-build") || strings.HasPrefix(base, "tmp") {
		return "relay.sqlite"
	}
	return filepath.Join(dir, "relay.sqlite")
}

func printBanner(scheme, listen, dbPath string) {
	host, port, err := net.SplitHostPort(listen)
	if err != nil {
		port = "8787"
		host = ""
	}
	fmt.Printf("enso-relay %s\n", version)
	fmt.Printf("  监听    %s://%s\n", scheme, displayAddr(host, port))
	fmt.Printf("  本机    %s://127.0.0.1:%s\n", scheme, port)
	for _, ip := range lanIPs() {
		fmt.Printf("  局域网  %s://%s:%s\n", scheme, ip, port)
	}
	fmt.Printf("  数据库  %s\n", dbPath)
	fmt.Printf("  手机打开上面的地址即可配对（已内嵌 PWA）\n")
}

func displayAddr(host, port string) string {
	if host == "" || host == "0.0.0.0" || host == "::" {
		return "0.0.0.0:" + port
	}
	return net.JoinHostPort(host, port)
}

func lanIPs() []string {
	var out []string
	ifaces, err := net.Interfaces()
	if err != nil {
		return out
	}
	for _, iface := range ifaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addrs, err := iface.Addrs()
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			ipNet, ok := addr.(*net.IPNet)
			if !ok || ipNet.IP.IsLoopback() {
				continue
			}
			ip := ipNet.IP.To4()
			if ip == nil {
				continue
			}
			out = append(out, ip.String())
		}
	}
	return out
}
