// WebSocket client for real-time health updates
// Connects to the backend health WebSocket endpoint for live provider health monitoring

export type HealthUpdateMessage = {
  type: 'health_update';
  providerId: string;
  metrics: {
    providerId: string;
    isHealthy: boolean;
    healthScore: number;
    responseTime: {
      average: number;
      p95: number;
      p99: number;
    };
    errorRate: {
      rate: number;
      recentErrors: number;
      totalRequests: number;
    };
    quotaStatus: {
      usagePercent: number;
      remaining: number;
      limit: number;
      resetTime?: string;
    };
    accountStatus: {
      hasValidAccounts: boolean;
      accountsNearExpiry: boolean;
      activeAccounts: number;
      totalAccounts: number;
    };
    lastChecked: number;
    lastUpdated: number;
  };
  timestamp: number;
};

export type HealthSummaryMessage = {
  type: 'health_summary';
  summary: {
    totalProviders: number;
    healthyProviders: number;
    degradedProviders: number;
    unhealthyProviders: number;
    averageHealthScore: number;
  };
  timestamp: number;
};

export type HealthMessage = HealthUpdateMessage | HealthSummaryMessage;

export type HealthUpdateCallback = (message: HealthMessage) => void;

export class HealthWebSocketClient {
  private ws: WebSocket | null = null;
  private callbacks = new Set<HealthUpdateCallback>();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 1000; // Start with 1 second
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;

  constructor(private readonly wsUrl: string = '/ws/health') {}

  /**
   * Connect to the health WebSocket
   */
  connect(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return; // Already connected
    }

    if (this.isConnecting) {
      return; // Connection attempt in progress
    }

    this.isConnecting = true;

    try {
      // Create WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const url = `${protocol}//${host}${this.wsUrl}`;

      console.log('Connecting to health WebSocket:', url);
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        console.log('Health WebSocket connected');
        this.isConnecting = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
      };

      this.ws.onmessage = (event) => {
        try {
          const message: HealthMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error('Failed to parse health WebSocket message:', error);
        }
      };

      this.ws.onclose = (event) => {
        console.log('Health WebSocket disconnected:', event.code, event.reason);
        this.isConnecting = false;
        this.ws = null;

        // Attempt to reconnect if not a clean close
        if (event.code !== 1000 && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.scheduleReconnect();
        }
      };

      this.ws.onerror = (error) => {
        console.error('Health WebSocket error:', error);
        this.isConnecting = false;
      };

    } catch (error) {
      console.error('Failed to create health WebSocket:', error);
      this.isConnecting = false;
    }
  }

  /**
   * Disconnect from the health WebSocket
   */
  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this.isConnecting = false;
    this.reconnectAttempts = 0;
  }

  /**
   * Subscribe to health updates
   */
  subscribe(callback: HealthUpdateCallback): () => void {
    this.callbacks.add(callback);

    // Auto-connect when first subscriber is added
    if (this.callbacks.size === 1) {
      this.connect();
    }

    // Return unsubscribe function
    return () => {
      this.callbacks.delete(callback);

      // Auto-disconnect when no subscribers
      if (this.callbacks.size === 0) {
        this.disconnect();
      }
    };
  }

  /**
   * Get current connection status
   */
  getConnectionStatus(): 'connecting' | 'connected' | 'disconnected' | 'error' {
    if (this.isConnecting) {
      return 'connecting';
    }

    if (!this.ws) {
      return 'disconnected';
    }

    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return 'connecting';
      case WebSocket.OPEN:
        return 'connected';
      case WebSocket.CLOSING:
      case WebSocket.CLOSED:
        return 'disconnected';
      default:
        return 'error';
    }
  }

  /**
   * Handle incoming WebSocket message
   */
  private handleMessage(message: HealthMessage): void {
    // Broadcast to all subscribers
    for (const callback of this.callbacks) {
      try {
        callback(message);
      } catch (error) {
        console.error('Error in health update callback:', error);
      }
    }
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);

    console.log(`Scheduling health WebSocket reconnect attempt ${this.reconnectAttempts} in ${delay}ms`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

// Global health WebSocket client instance
export const healthWebSocketClient = new HealthWebSocketClient();