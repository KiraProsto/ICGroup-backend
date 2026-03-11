import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UserResponseDto } from './dto/user-response.dto.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { CheckPolicies } from '../casl/decorators/check-policies.decorator.js';
import {
  ApiErrorResponseDto,
  ApiPaginatedResponseDto,
  ApiResponseDto,
} from '../../common/dto/api-response.dto.js';
import { CurrentUser, type AuthenticatedUser } from '../auth/decorators/current-user.decorator.js';

/**
 * Admin user management endpoints — SUPER_ADMIN only.
 *
 * All routes sit behind both JwtAuthGuard (global) and PoliciesGuard (global).
 * The @CheckPolicies decorator restricts every route to users whose CASL
 * ability allows 'manage' on 'User' — i.e. SUPER_ADMIN only.
 */
@ApiTags('admin/users')
@ApiBearerAuth('access-token')
@Controller('admin/users')
@CheckPolicies((ability) => ability.can('manage', 'User'))
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // ─── GET /admin/users ──────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'List all users (paginated). SUPER_ADMIN only.' })
  @ApiOkResponse({ type: ApiPaginatedResponseDto(UserResponseDto) })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  findAll(@Query() query: ListUsersQueryDto) {
    return this.usersService.findAll(query);
  }

  // ─── GET /admin/users/:id ──────────────────────────────────────────────

  @Get(':id')
  @ApiOperation({ summary: 'Get a single user by ID. SUPER_ADMIN only.' })
  @ApiOkResponse({ type: ApiResponseDto(UserResponseDto) })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.usersService.findOne(id);
  }

  // ─── POST /admin/users ─────────────────────────────────────────────────

  @Post()
  @ApiOperation({ summary: 'Create a new user. SUPER_ADMIN only.' })
  @ApiCreatedResponse({ type: ApiResponseDto(UserResponseDto) })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'Email already in use' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  create(@Body() dto: CreateUserDto, @CurrentUser() actor: AuthenticatedUser) {
    return this.usersService.create(dto, actor);
  }

  // ─── PATCH /admin/users/:id ────────────────────────────────────────────

  @Patch(':id')
  @ApiOperation({
    summary: 'Update user role, active state, or password. SUPER_ADMIN only.',
  })
  @ApiOkResponse({ type: ApiResponseDto(UserResponseDto) })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.usersService.update(id, dto, actor);
  }

  // ─── DELETE /admin/users/:id ───────────────────────────────────────────

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Soft-delete a user. SUPER_ADMIN only.' })
  @ApiOkResponse({ type: ApiResponseDto(UserResponseDto) })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  remove(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.usersService.remove(id, actor);
  }

  // ─── POST /admin/users/:id/restore ─────────────────────────────────────

  @Post(':id/restore')
  @ApiOperation({ summary: 'Restore a soft-deleted user. SUPER_ADMIN only.' })
  @ApiOkResponse({ type: ApiResponseDto(UserResponseDto) })
  @ApiNotFoundResponse({ type: ApiErrorResponseDto })
  @ApiConflictResponse({ type: ApiErrorResponseDto, description: 'User is not deleted' })
  @ApiUnauthorizedResponse({ type: ApiErrorResponseDto })
  @ApiForbiddenResponse({ type: ApiErrorResponseDto })
  restore(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.usersService.restore(id, actor);
  }
}
