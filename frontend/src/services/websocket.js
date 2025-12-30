/**
 * WebSocket Service
 * Handles real-time data streaming from backend
 */

class WebSocketService {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 1000;
    this.isConnecting = false;
    this.callbacks = {
      priceUpdate: [],
      connected: [],
      disconnected: [],
      error: []
    };
  }

  connect(accessToken, userId, symbols = []) {
    if (this.isConnecting || (this.ws && this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this.isConnecting = true;
    // Use relative URL for WebSocket (Vite proxy will handle it)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const url = `${protocol}//${host}/api/ws/prices`;

    try {
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('WebSocket connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;

        // Send initial subscription
        this.ws.send(JSON.stringify({
          action: 'subscribe',
          access_token: accessToken,
          user_id: userId,
          symbols: symbols
        }));

        // Notify callbacks
        this.callbacks.connected.forEach(cb => cb());
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          this.handleMessage(data);
        } catch (error) {
          console.error('Error parsing WebSocket message:', error);
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        this.isConnecting = false;
        this.callbacks.error.forEach(cb => cb(error));
      };

      this.ws.onclose = () => {
        console.log('WebSocket disconnected');
        this.isConnecting = false;
        this.callbacks.disconnected.forEach(cb => cb());

        // Attempt to reconnect
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          setTimeout(() => {
            console.log(`Reconnecting... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
            this.connect(accessToken, userId, symbols);
          }, this.reconnectDelay * this.reconnectAttempts);
        }
      };
    } catch (error) {
      console.error('Error creating WebSocket:', error);
      this.isConnecting = false;
      this.callbacks.error.forEach(cb => cb(error));
    }
  }

  handleMessage(data) {
    switch (data.type) {
      case 'price_update':
        this.callbacks.priceUpdate.forEach(cb => cb(data));
        break;
      case 'connected':
        console.log('WebSocket connection confirmed:', data.message);
        break;
      case 'subscribed':
        console.log('Subscribed to symbols:', data.symbols);
        break;
      case 'error':
        console.error('WebSocket error:', data.message);
        this.callbacks.error.forEach(cb => cb(new Error(data.message)));
        break;
      case 'pong':
        // Heartbeat response
        break;
      default:
        console.log('Unknown WebSocket message type:', data.type);
    }
  }

  subscribe(symbols) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        action: 'subscribe',
        symbols: symbols
      }));
    }
  }

  unsubscribe(symbols) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        action: 'unsubscribe',
        symbols: symbols
      }));
    }
  }

  onPriceUpdate(callback) {
    this.callbacks.priceUpdate.push(callback);
  }

  onConnected(callback) {
    this.callbacks.connected.push(callback);
  }

  onDisconnected(callback) {
    this.callbacks.disconnected.push(callback);
  }

  onError(callback) {
    this.callbacks.error.push(callback);
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.reconnectAttempts = 0;
  }

  sendPing() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ action: 'ping' }));
    }
  }
}

// Export singleton instance
export const websocketService = new WebSocketService();
export default websocketService;

