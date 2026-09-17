package main

import (
	"encoding/json"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
)

type frame struct {
	messageType int
	data        []byte
	closeCode   int
	closeText   string
}

type peer struct {
	id        uint64
	role      string
	send      chan frame
	done      chan struct{}
	closeOnce sync.Once
}

func newPeer(role string) *peer {
	return &peer{
		id:   peerSeq.Add(1),
		role: role,
		send: make(chan frame, 16),
		done: make(chan struct{}),
	}
}

var peerSeq atomic.Uint64

func (p *peer) trySend(fr frame) {
	select {
	case p.send <- fr:
	case <-p.done:
	}
}

func (p *peer) sendJSON(v any) {
	b, err := json.Marshal(v)
	if err != nil {
		return
	}
	p.trySend(frame{messageType: websocket.TextMessage, data: b})
}

func (p *peer) close(code int, reason string) {
	p.closeOnce.Do(func() {
		p.trySend(frame{closeCode: code, closeText: reason})
	})
}

func (p *peer) writePump(conn *websocket.Conn) {
	ticker := time.NewTicker(60 * time.Second)
	defer func() {
		ticker.Stop()
		close(p.done)
		_ = conn.Close()
	}()
	for {
		select {
		case fr, ok := <-p.send:
			if !ok {
				return
			}
			_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if fr.closeCode != 0 {
				_ = conn.WriteMessage(websocket.CloseMessage, websocket.FormatCloseMessage(fr.closeCode, fr.closeText))
				return
			}
			if err := conn.WriteMessage(fr.messageType, fr.data); err != nil {
				return
			}
		case <-ticker.C:
			_ = conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

type room struct {
	mu    sync.Mutex
	host  *peer
	guest *peer
}

type hub struct {
	mu    sync.Mutex
	rooms map[string]*room
}

func newHub() *hub {
	return &hub{rooms: make(map[string]*room)}
}

func (h *hub) room(pairID string) *room {
	h.mu.Lock()
	defer h.mu.Unlock()
	r := h.rooms[pairID]
	if r == nil {
		r = &room{}
		h.rooms[pairID] = r
	}
	return r
}

func (h *hub) join(pairID, role string, p *peer) {
	r := h.room(pairID)
	r.mu.Lock()
	var stale *peer
	var other *peer
	if role == roleHost {
		stale = r.host
		r.host = p
		other = r.guest
	} else {
		stale = r.guest
		r.guest = p
		other = r.host
	}
	r.mu.Unlock()

	if stale != nil {
		stale.close(websocket.CloseNormalClosure, "replaced")
	}
	if role == roleHost {
		if other != nil {
			other.sendJSON(map[string]string{"type": "host-online"})
			p.sendJSON(map[string]string{"type": "peer-joined"})
		}
	} else {
		if other != nil {
			other.sendJSON(map[string]string{"type": "peer-joined"})
			p.sendJSON(map[string]string{"type": "host-online"})
		} else {
			p.sendJSON(map[string]string{"type": "host-offline"})
		}
	}
}

func (h *hub) leave(pairID, role string, id uint64) {
	h.mu.Lock()
	r := h.rooms[pairID]
	h.mu.Unlock()
	if r == nil {
		return
	}
	r.mu.Lock()
	var cur **peer
	var other *peer
	offline := map[string]string{"type": "peer-left"}
	if role == roleHost {
		cur = &r.host
		other = r.guest
		offline = map[string]string{"type": "host-offline"}
	} else {
		cur = &r.guest
		other = r.host
	}
	if *cur == nil || (*cur).id != id {
		r.mu.Unlock()
		return
	}
	*cur = nil
	empty := r.host == nil && r.guest == nil
	r.mu.Unlock()
	if other != nil {
		other.sendJSON(offline)
	}
	if empty {
		h.mu.Lock()
		if h.rooms[pairID] == r {
			delete(h.rooms, pairID)
		}
		h.mu.Unlock()
	}
}

func (h *hub) forward(pairID, fromRole string, messageType int, data []byte) {
	h.mu.Lock()
	r := h.rooms[pairID]
	h.mu.Unlock()
	if r == nil {
		return
	}
	r.mu.Lock()
	var dst *peer
	if fromRole == roleHost {
		dst = r.guest
	} else {
		dst = r.host
	}
	r.mu.Unlock()
	if dst != nil {
		dst.trySend(frame{messageType: messageType, data: data})
	}
}

func (h *hub) revoke(pairID string) {
	h.mu.Lock()
	r := h.rooms[pairID]
	delete(h.rooms, pairID)
	h.mu.Unlock()
	if r == nil {
		return
	}
	r.mu.Lock()
	host, guest := r.host, r.guest
	r.host, r.guest = nil, nil
	r.mu.Unlock()
	msg := map[string]string{"type": "revoked"}
	for _, p := range []*peer{host, guest} {
		if p == nil {
			continue
		}
		p.sendJSON(msg)
		p.close(websocket.ClosePolicyViolation, "revoked")
	}
}
