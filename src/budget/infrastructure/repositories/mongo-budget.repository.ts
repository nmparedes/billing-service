import { Inject, Injectable } from "@nestjs/common";
import { Collection, Filter, MongoClient } from "mongodb";
import { MONGO_CLIENT } from "../../../database/database.constants";
import { PaginatedResponse } from "../../../common/interfaces/paginated-response.interface";
import {
  Budget,
  RestoreBudgetProps,
} from "../../domain/entities/budget.entity";
import { BudgetListFilters } from "../../domain/repositories/budget-list-filters.interface";
import type { BudgetRepository } from "../../domain/repositories/budget.repository.interface";

interface BudgetDocument extends Omit<RestoreBudgetProps, "id"> {
  _id: string;
}

@Injectable()
export class MongoBudgetRepository implements BudgetRepository {
  constructor(@Inject(MONGO_CLIENT) private readonly client: MongoClient) {}

  async findById(id: string): Promise<Budget | null> {
    const document = await (await this.collection()).findOne({ _id: id });
    return document ? this.toDomain(document) : null;
  }

  async findAll(
    filters: BudgetListFilters,
  ): Promise<PaginatedResponse<Budget>> {
    const query: Filter<BudgetDocument> = {};
    if (filters.orderId) {
      query.orderId = filters.orderId;
    }
    if (filters.orderNumber) {
      query.orderNumber = filters.orderNumber;
    }
    if (filters.status) {
      query.status = filters.status;
    }
    if (filters.customerDocument) {
      query["customer.customerDocument"] = filters.customerDocument;
    }

    const collection = await this.collection();
    const cursor = collection
      .find(query)
      .sort({ requestedAt: -1, createdAt: -1, _id: -1 })
      .skip((filters.page - 1) * filters.limit)
      .limit(filters.limit);

    const [documents, total] = await Promise.all([
      cursor.toArray(),
      collection.countDocuments(query),
    ]);

    return {
      data: documents.map((document) => this.toDomain(document)),
      meta: {
        total,
        page: filters.page,
        limit: filters.limit,
        totalPages: total === 0 ? 0 : Math.ceil(total / filters.limit),
      },
    };
  }

  async findBySagaAndOrder(
    sagaId: string,
    orderId: string,
  ): Promise<Budget | null> {
    const document = await (
      await this.collection()
    ).findOne({ sagaId, orderId });
    return document ? this.toDomain(document) : null;
  }

  async createIfAbsent(budget: Budget): Promise<Budget> {
    const document = await (
      await this.collection()
    ).findOneAndUpdate(
      { sagaId: budget.sagaId, orderId: budget.orderId },
      { $setOnInsert: this.toDocument(budget) },
      { upsert: true, returnDocument: "after" },
    );
    return this.toDomain(document ?? this.toDocument(budget));
  }

  async save(budget: Budget): Promise<Budget> {
    await (
      await this.collection()
    ).updateOne({ _id: budget.id }, { $set: this.toDocument(budget) });
    return budget;
  }

  private async collection(): Promise<Collection<BudgetDocument>> {
    const collection = this.client.db().collection<BudgetDocument>("budgets");
    await collection.createIndex(
      { sagaId: 1, orderId: 1 },
      { unique: true, name: "budget_saga_order_unique" },
    );
    return collection;
  }

  private toDomain(document: BudgetDocument): Budget {
    const { _id, ...props } = document;
    return Budget.restore({ id: _id, ...props });
  }

  private toDocument(budget: Budget): BudgetDocument {
    return {
      _id: budget.id,
      sagaId: budget.sagaId,
      orderId: budget.orderId,
      orderNumber: budget.orderNumber,
      customer: budget.customer,
      vehicle: budget.vehicle,
      serviceItems: budget.serviceItems,
      partItems: budget.partItems,
      serviceSubtotal: budget.serviceSubtotal,
      partSubtotal: budget.partSubtotal,
      totalAmount: budget.totalAmount,
      status: budget.status,
      rejectionReason: budget.rejectionReason,
      requestedAt: budget.requestedAt,
      createdAt: budget.createdAt,
      approvalRequestedAt: budget.approvalRequestedAt,
      approvedAt: budget.approvedAt,
      rejectedAt: budget.rejectedAt,
      expiresAt: budget.expiresAt,
      updatedAt: budget.updatedAt,
    };
  }
}
