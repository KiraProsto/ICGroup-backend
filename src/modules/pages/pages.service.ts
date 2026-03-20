import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ZodError } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import {
  AuditAction,
  AuditResourceType,
  ContentStatus,
  SectionType,
} from '../../generated/prisma/enums.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import type { AuthenticatedUser } from '../auth/decorators/current-user.decorator.js';
import { PublicService } from '../public/public.service.js';
import {
  paginatedResult,
  type PaginatedResult,
} from '../../common/interceptors/transform-response.interceptor.js';
import type { CreatePageDto } from './dto/create-page.dto.js';
import type { ListPagesQueryDto } from './dto/list-pages-query.dto.js';
import type { UpsertPageDto } from './dto/upsert-page.dto.js';
import type { UpdatePageDto } from './dto/update-page.dto.js';
import type {
  PageResponseDto,
  PageSectionResponseDto,
  PageSummaryResponseDto,
} from './dto/page-response.dto.js';
import { SectionDataSchemas } from './schemas/section-data.schema.js';

// ─── Prisma select shapes ─────────────────────────────────────────────────────

const PAGE_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  publishedAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
} as const;

const SECTION_SELECT = {
  id: true,
  type: true,
  order: true,
  data: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Combined page + sections select — eliminates a second round-trip in read operations. */
const PAGE_WITH_SECTIONS_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  publishedAt: true,
  createdById: true,
  createdAt: true,
  updatedAt: true,
  sections: {
    select: SECTION_SELECT,
    orderBy: { order: 'asc' as const },
  },
} as const;

// ─── Mappers ──────────────────────────────────────────────────────────────────

type PageRow = {
  id: string;
  slug: string;
  name: string;
  status: (typeof ContentStatus)[keyof typeof ContentStatus];
  publishedAt: Date | null;
  createdById: string;
  createdAt: Date;
  updatedAt: Date;
};

type SectionRow = {
  id: string;
  type: SectionType;
  order: number;
  data: Prisma.JsonValue;
  createdAt: Date;
  updatedAt: Date;
};

function mapSection(row: SectionRow): PageSectionResponseDto {
  return {
    id: row.id,
    type: row.type,
    order: row.order,
    data: row.data as Record<string, unknown>,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapPageSummary(row: PageRow): PageSummaryResponseDto {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapPage(row: PageRow, sections: SectionRow[]): PageResponseDto {
  return {
    ...mapPageSummary(row),
    sections: sections.map(mapSection),
  };
}

/**
 * Strips non-serialisable or sensitive fields for audit snapshots.
 */
function toAuditSnapshot(page: PageRow): Record<string, unknown> {
  return {
    id: page.id,
    slug: page.slug,
    name: page.name,
    status: page.status,
    publishedAt: page.publishedAt?.toISOString() ?? null,
    createdById: page.createdById,
  };
}

// ─── Service ──────────────────────────────────────────────────────────────────
const SERIALIZABLE_RETRY_LIMIT = 5;
/**
 * PagesService manages dynamic pages identified by a unique slug.
 *
 * Key invariants:
 *  - Page.slug is UNIQUE — create a page first, then update its sections.
 *  - replaceSections performs a full transactional replace of all sections (Serializable).
 *  - Each section's data JSONB payload is validated by Zod before persistence.
 *  - Publish and archive log via BullMQ (operational events).
 */
@Injectable()
export class PagesService {
  private readonly logger = new Logger(PagesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly publicService: PublicService,
  ) {}

  // ─── create ──────────────────────────────────────────────────────────────

  async create(dto: CreatePageDto, actor: AuthenticatedUser): Promise<PageSummaryResponseDto> {
    const page = await this.prisma.page
      .create({
        data: {
          slug: dto.slug,
          name: dto.name,
          status: ContentStatus.DRAFT,
          createdById: actor.id,
        },
        select: PAGE_SELECT,
      })
      .catch((e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          throw new ConflictException(`Page with slug "${dto.slug}" already exists`);
        }
        throw e;
      });

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.CREATE,
      resourceType: AuditResourceType.Page,
      resourceId: page.id,
      beforeSnapshot: null,
      afterSnapshot: toAuditSnapshot(page),
    });

    return mapPageSummary(page);
  }

  // ─── findAll ─────────────────────────────────────────────────────────────

  async findAll(query: ListPagesQueryDto): Promise<PaginatedResult<PageSummaryResponseDto>> {
    const page = query.page ?? 1;
    const perPage = query.perPage ?? 20;
    const where = query.status ? { status: query.status } : {};

    const [pages, total] = await Promise.all([
      this.prisma.page.findMany({
        where,
        select: PAGE_SELECT,
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * perPage,
        take: perPage,
      }),
      this.prisma.page.count({ where }),
    ]);

    return paginatedResult(pages.map(mapPageSummary), {
      total,
      page,
      perPage,
      totalPages: Math.ceil(total / perPage),
    });
  }

  // ─── findOne ─────────────────────────────────────────────────────────────

  async findOne(slug: string): Promise<PageResponseDto> {
    const result = await this.prisma.page.findUnique({
      where: { slug },
      select: PAGE_WITH_SECTIONS_SELECT,
    });

    if (!result) {
      throw new NotFoundException(`Page "${slug}" not found`);
    }

    const { sections, ...pageRow } = result;
    return mapPage(pageRow, sections);
  }

  // ─── updateName ──────────────────────────────────────────────────────────

  async updateName(
    slug: string,
    dto: UpdatePageDto,
    actor: AuthenticatedUser,
  ): Promise<PageSummaryResponseDto> {
    const existing = await this.findPageOrThrow(slug);
    const before = toAuditSnapshot(existing);

    const updated = await this.prisma.page
      .update({
        where: { id: existing.id },
        data: { name: dto.name },
        select: PAGE_SELECT,
      })
      .catch(async (e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
          throw new NotFoundException(`Page "${slug}" not found`);
        }
        throw e;
      });

    // Invalidate public cache before writing to audit log — ensures cache is
    // cleared even if the audit enqueue fails.
    if (existing.status === ContentStatus.PUBLISHED) {
      await this.publicService.invalidatePage(slug);
    }

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.UPDATE,
      resourceType: AuditResourceType.Page,
      resourceId: existing.id,
      beforeSnapshot: before,
      afterSnapshot: toAuditSnapshot(updated),
    });

    return mapPageSummary(updated);
  }

  // ─── replaceSections ────────────────────────────────────────────────────────

  /**
   * Atomically replaces all sections of an existing page within a single
   * serializable transaction. Throws 404 if the page does not exist.
   *
   * Zod validates each section's data before the transaction begins so that
   * invalid payloads never reach the database.
   */
  async replaceSections(
    slug: string,
    dto: UpsertPageDto,
    actor: AuthenticatedUser,
  ): Promise<PageResponseDto> {
    // ── Validate section data payloads before touching the DB ────────────
    this.validateSectionData(dto);

    // ── Transactional replace-all (Serializable + retry prevents concurrent data loss) ──
    const result = await this.withSerializableTx(async (tx) => {
      // Read before-state INSIDE the transaction so the snapshot is consistent
      // with the write and we fail fast if the page does not exist.
      const existingPage = await tx.page.findUnique({
        where: { slug },
        select: PAGE_SELECT,
      });

      if (!existingPage) {
        throw new NotFoundException(`Page "${slug}" not found`);
      }

      // Capture before-sections for the audit trail.
      const beforeSections = await tx.pageSection.findMany({
        where: { pageId: existingPage.id },
        select: { id: true, type: true, order: true },
        orderBy: { order: 'asc' },
      });

      // Touch updatedAt so it reflects this change.
      const page = await tx.page.update({
        where: { id: existingPage.id },
        data: { updatedAt: new Date() },
        select: PAGE_SELECT,
      });

      // Delete all existing sections (cascade is on Page delete, not here, so explicit delete).
      await tx.pageSection.deleteMany({ where: { pageId: page.id } });

      if (dto.sections.length > 0) {
        await tx.pageSection.createMany({
          data: dto.sections.map((s) => ({
            pageId: page.id,
            type: s.type,
            order: s.order,
            data: s.data as Prisma.InputJsonValue,
          })),
        });
      }

      const sections = await tx.pageSection.findMany({
        where: { pageId: page.id },
        select: SECTION_SELECT,
        orderBy: { order: 'asc' },
      });

      return { page, sections, existingPage, beforeSections };
    });

    // Invalidate public cache before writing to audit log — ensures cache is
    // cleared even if the audit enqueue fails.
    if (result.existingPage.status === ContentStatus.PUBLISHED) {
      await this.publicService.invalidatePage(slug);
    }

    // ── Async audit — includes section summaries for a meaningful diff ────
    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.UPDATE,
      resourceType: AuditResourceType.Page,
      resourceId: result.page.id,
      beforeSnapshot: {
        ...toAuditSnapshot(result.existingPage),
        sections: result.beforeSections.map(({ id, type, order }) => ({ id, type, order })),
      },
      afterSnapshot: {
        ...toAuditSnapshot(result.page),
        sections: result.sections.map(({ id, type, order }) => ({ id, type, order })),
      },
      metadata: { sectionCount: result.sections.length },
    });

    return mapPage(result.page, result.sections);
  }

  // ─── publish ─────────────────────────────────────────────────────────────

  async publish(slug: string, actor: AuthenticatedUser): Promise<PageResponseDto> {
    const page = await this.findPageOrThrow(slug);
    const before = toAuditSnapshot(page);

    // Atomic guard: the WHERE condition ensures this update only succeeds if
    // the page is not already PUBLISHED, closing the TOCTOU race between two
    // concurrent publish calls. Prisma throws P2025 when the filter does not match.
    const updated = await this.prisma.page
      .update({
        where: { id: page.id, status: { not: ContentStatus.PUBLISHED } },
        data: { status: ContentStatus.PUBLISHED, publishedAt: new Date() },
        select: PAGE_WITH_SECTIONS_SELECT,
      })
      .catch(async (e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
          // Re-read to distinguish between "deleted" and "already published".
          const current = await this.prisma.page.findUnique({
            where: { id: page.id },
            select: { status: true },
          });
          if (!current) {
            throw new NotFoundException(`Page "${slug}" not found`);
          }
          throw new ConflictException(`Page "${slug}" is already published`);
        }
        throw e;
      });

    const { sections, ...updatedPage } = updated;

    // Invalidate public cache before writing to audit log — ensures cache is
    // cleared even if the audit enqueue fails.
    await this.publicService.invalidatePage(slug);

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.PUBLISH,
      resourceType: AuditResourceType.Page,
      resourceId: page.id,
      beforeSnapshot: before,
      afterSnapshot: toAuditSnapshot(updatedPage),
    });

    return mapPage(updatedPage, sections);
  }

  // ─── archive ──────────────────────────────────────────────────────────────

  async archive(slug: string, actor: AuthenticatedUser): Promise<PageResponseDto> {
    const page = await this.findPageOrThrow(slug);
    const before = toAuditSnapshot(page);

    // Atomic guard: update only succeeds when the page is currently PUBLISHED.
    // On P2025 we re-read to give a context-specific error (DRAFT vs ARCHIVED),
    // eliminating the stale-read false-rejection where a concurrent publish makes
    // a pre-check here incorrectly reject a valid archive transition.
    const updated = await this.prisma.page
      .update({
        where: { id: page.id, status: ContentStatus.PUBLISHED },
        data: { status: ContentStatus.ARCHIVED },
        select: PAGE_WITH_SECTIONS_SELECT,
      })
      .catch(async (e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
          const current = await this.prisma.page.findUnique({
            where: { id: page.id },
            select: { status: true },
          });
          if (!current) {
            throw new NotFoundException(`Page "${slug}" not found`);
          }
          if (current.status === ContentStatus.DRAFT) {
            throw new ConflictException(`Cannot archive a DRAFT page. Publish it first.`);
          }
          throw new ConflictException(`Page "${slug}" is already archived`);
        }
        throw e;
      });

    const { sections, ...updatedPage } = updated;

    // Invalidate public cache before writing to audit log — ensures cache is
    // cleared even if the audit enqueue fails.
    await this.publicService.invalidatePage(slug);

    await this.auditService.logAsync({
      actorId: actor.id,
      action: AuditAction.ARCHIVE,
      resourceType: AuditResourceType.Page,
      resourceId: page.id,
      beforeSnapshot: before,
      afterSnapshot: toAuditSnapshot(updatedPage),
    });

    return mapPage(updatedPage, sections);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Fetches page row or throws NotFoundException. */
  private async findPageOrThrow(slug: string): Promise<PageRow> {
    const page = await this.prisma.page.findUnique({
      where: { slug },
      select: PAGE_SELECT,
    });

    if (!page) {
      throw new NotFoundException(`Page "${slug}" not found`);
    }

    return page;
  }

  /**
   * Executes `operation` in a Serializable transaction, retrying up to
   * SERIALIZABLE_RETRY_LIMIT times on P2034 (serialization conflict) with
   * exponential backoff + jitter to reduce thundering-herd.
   */
  private async withSerializableTx<T>(
    operation: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_LIMIT; attempt++) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 30_000,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < SERIALIZABLE_RETRY_LIMIT
        ) {
          await this.sleep(50 * Math.min(2 ** (attempt - 1), 10) + Math.random() * 50);
          continue;
        }
        throw error;
      }
    }
    throw new Error('Exceeded serializable transaction retry limit');
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Validates all section data payloads against their Zod schemas.
   * Throws BadRequestException with field-level details on failure.
   */
  private validateSectionData(dto: UpsertPageDto): void {
    // Guard against duplicate order values within the submitted section list.
    if (dto.sections.length > 1) {
      const orders = dto.sections.map((s) => s.order);
      if (new Set(orders).size !== orders.length) {
        throw new BadRequestException('Section order values must be unique within a page');
      }
    }

    const errors: { index: number; type: string; issues: unknown }[] = [];

    for (let i = 0; i < dto.sections.length; i++) {
      const section = dto.sections[i];
      const schema = SectionDataSchemas[section.type];

      const result = schema.safeParse(section.data);
      if (!result.success) {
        errors.push({
          index: i,
          type: section.type,
          issues: (result.error as ZodError).flatten(),
        });
      }
    }

    if (errors.length > 0) {
      this.logger.debug(`Section data validation failed for ${errors.length} section(s)`);
      throw new BadRequestException({
        message: 'Section data validation failed',
        errors,
      });
    }
  }
}
