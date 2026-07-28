import {
  Controller,
  Get,
  Header,
  Inject,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOkResponse, ApiTags } from "@nestjs/swagger";
import type { MongoClient } from "mongodb";
import { Public } from "../auth/decorators/public.decorator";
import { metricsRegistry } from "../common/metrics/metrics.registry";
import { MONGO_CLIENT } from "../database/database.constants";

type HealthResponse = {
  status: "ok";
  service: string;
};

type ReadyResponse = HealthResponse & {
  version: string;
};

@ApiTags("platform")
@Public()
@Controller()
export class HealthController {
  constructor(
    private readonly configService: ConfigService,
    @Inject(MONGO_CLIENT) private readonly mongoClient: MongoClient,
  ) {}

  @Get("health")
  @ApiOkResponse({ description: "Liveness probe response." })
  health(): HealthResponse {
    return {
      status: "ok",
      service: this.configService.get<string>(
        "SERVICE_NAME",
        "billing-service",
      ),
    };
  }

  @Get("ready")
  @ApiOkResponse({ description: "Readiness probe response." })
  async ready(): Promise<ReadyResponse> {
    try {
      await this.mongoClient.db().command({ ping: 1 });
    } catch {
      throw new ServiceUnavailableException({
        status: "unavailable",
        service: this.serviceName(),
      });
    }

    return {
      status: "ok",
      service: this.serviceName(),
      version: this.configService.get<string>("SERVICE_VERSION", "0.1.0"),
    };
  }

  @Get("metrics")
  @Header("Content-Type", metricsRegistry.contentType)
  @ApiOkResponse({ description: "Prometheus metrics response." })
  metrics(): Promise<string> {
    return metricsRegistry.metrics();
  }

  private serviceName(): string {
    return this.configService.get<string>("SERVICE_NAME", "billing-service");
  }
}
