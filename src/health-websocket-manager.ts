import type { FastifyInstance } from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import type { ProviderHealthService, ProviderHealthMetrics } from "./provider-health-service.js";

export type HealthUpdateMessage = {
  type: 'health_update';
  providerId: string;
  metrics: ProviderHealthMetrics;
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

export class HealthWebSocketManager {
  private connections = new Set<any>();
  private updateInterval: NodeJS.Timeout | null = null;
  private initialized = false;

  constructor(
    private readonly healthService: ProviderHealthService,
    private readonly broadcastInterval = 5000 // 5 seconds
  ) {}

  /**
   * Initialize WebSocket support on Fastify server
   */
  async initialize(app: FastifyInstance): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.initialized = true;

    // Register WebSocket plugin
    await app.register(fastifyWebsocket);

    // Health updates WebSocket endpoint
    await app.register(async (fastify) => {
      fastify.get('/ws/health', { websocket: true }, (connection: any, req: any) => {
        console.log('New health WebSocket connection established');

        // Add connection to active connections
        this.connections.add(connection);

        // Send initial health summary
        const summary = this.healthService.getHealthSummary();
        const summaryMessage: HealthSummaryMessage = {
          type: 'health_summary',
          summary,
          timestamp: Date.now()
        };
        connection.send(JSON.stringify(summaryMessage));

        // Send current health data for all providers
        const allHealth = this.healthService.getAllProviderHealth();
        for (const [providerId, metrics] of allHealth) {
          const updateMessage: HealthUpdateMessage = {
            type: 'health_update',
            providerId,
            metrics,
            timestamp: Date.now()
          };
          connection.send(JSON.stringify(updateMessage));
        }

        // Handle connection close
        connection.on('close', () => {
          console.log('Health WebSocket connection closed');
          this.connections.delete(connection);
        });

        // Handle connection error
        connection.on('error', (error: any) => {
          console.error('Health WebSocket error:', error);
          this.connections.delete(connection);
        });
      });
    });

    // Start broadcasting health updates
    this.startBroadcasting();
  }

  /**
   * Start broadcasting health updates to all connected clients
   */
  private startBroadcasting(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
    }

    this.updateInterval = setInterval(() => {
      this.broadcastHealthUpdates();
    }, this.broadcastInterval);
  }

  /**
   * Stop broadcasting health updates
   */
  stopBroadcasting(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }
  }

  /**
   * Broadcast health updates to all connected clients
   */
  private broadcastHealthUpdates(): void {
    if (this.connections.size === 0) {
      return;
    }

    try {
      // Get current health data
      const allHealth = this.healthService.getAllProviderHealth();
      const summary = this.healthService.getHealthSummary();

      // Broadcast summary
      const summaryMessage: HealthSummaryMessage = {
        type: 'health_summary',
        summary,
        timestamp: Date.now()
      };
      this.broadcast(summaryMessage);

      // Broadcast individual provider updates
      for (const [providerId, metrics] of allHealth) {
        const updateMessage: HealthUpdateMessage = {
          type: 'health_update',
          providerId,
          metrics,
          timestamp: Date.now()
        };
        this.broadcast(updateMessage);
      }
    } catch (error) {
      console.error('Error broadcasting health updates:', error);
    }
  }

  /**
   * Broadcast a message to all connected clients
   */
  private broadcast(message: HealthMessage): void {
    const messageStr = JSON.stringify(message);
    const deadConnections: any[] = [];

    for (const connection of this.connections) {
      try {
        if (connection.readyState === 1) { // WebSocket.OPEN
          connection.send(messageStr);
        } else {
          deadConnections.push(connection);
        }
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
        deadConnections.push(connection);
      }
    }

    // Clean up dead connections
    for (const deadConnection of deadConnections) {
      this.connections.delete(deadConnection);
    }
  }

  /**
   * Broadcast immediate health update for a specific provider
   */
  broadcastProviderUpdate(providerId: string, metrics: ProviderHealthMetrics): void {
    const message: HealthUpdateMessage = {
      type: 'health_update',
      providerId,
      metrics,
      timestamp: Date.now()
    };
    this.broadcast(message);
  }

  /**
   * Get current connection count
   */
  getConnectionCount(): number {
    return this.connections.size;
  }

  /**
   * Close all connections and stop broadcasting
   */
  shutdown(): void {
    this.stopBroadcasting();

    for (const connection of this.connections) {
      try {
        connection.close();
      } catch (error) {
        console.error('Error closing WebSocket connection:', error);
      }
    }

    this.connections.clear();
  }
}