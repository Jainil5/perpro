"""Phase 1 initial schema: the 19 tables behind docs/MYOS/API.md.

Revision ID: 0001
Revises:
Create Date: 2026-11-21 12:05:20

Generated from the SQLAlchemy 2.0 mappings (``alembic revision --autogenerate``), then
reviewed: the table set, the enum CHECK constraints and the composite indexes are exactly
the ones described in docs/MYOS/DATA_MODEL.md. Later phases add their own revision here;
they must never edit this one.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0001'
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # tenancy -> work -> knowledge -> people -> signals
    op.create_table('users',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=False),
    sa.Column('display_name', sa.String(length=120), nullable=False),
    sa.Column('timezone', sa.String(length=64), nullable=True),
    sa.Column('avatar_url', sa.String(length=500), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_users'))
    )
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_users_email'), ['email'], unique=True)

    op.create_table('workspaces',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=120), nullable=False),
    sa.Column('slug', sa.String(length=64), nullable=False),
    sa.Column('timezone', sa.String(length=64), nullable=False),
    sa.Column('currency', sa.String(length=8), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_workspaces'))
    )
    with op.batch_alter_table('workspaces', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_workspaces_slug'), ['slug'], unique=True)

    op.create_table('activity_logs',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('verb', sa.String(length=16), nullable=False),
    sa.Column('entity_type', sa.String(length=24), nullable=False),
    sa.Column('entity_id', sa.String(length=36), nullable=True),
    sa.Column('entity_title', sa.String(length=200), nullable=True),
    sa.Column('summary', sa.String(length=300), nullable=True),
    sa.Column('project_id', sa.String(length=36), nullable=True),
    sa.Column('href', sa.String(length=300), nullable=True),
    sa.Column('actor', sa.String(length=64), nullable=False),
    sa.Column('payload', sa.JSON(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("verb IN ('created', 'updated', 'completed', 'reopened', 'deleted', 'commented', 'moved')", name=op.f('ck_activity_logs_verb')),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_activity_logs_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_activity_logs'))
    )
    with op.batch_alter_table('activity_logs', schema=None) as batch_op:
        batch_op.create_index('ix_activity_logs_entity', ['entity_type', 'entity_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_activity_logs_project_id'), ['project_id'], unique=False)
        batch_op.create_index('ix_activity_logs_workspace_created', ['workspace_id', 'created_at'], unique=False)
        batch_op.create_index(batch_op.f('ix_activity_logs_workspace_id'), ['workspace_id'], unique=False)
        batch_op.create_index('ix_activity_logs_workspace_project', ['workspace_id', 'project_id'], unique=False)

    op.create_table('companies',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('website', sa.String(length=500), nullable=True),
    sa.Column('industry', sa.String(length=80), nullable=True),
    sa.Column('location', sa.String(length=120), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False, comment="origin of the row; 'demo' rows are the only ones /demo/reset removes"),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_companies_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_companies'))
    )
    with op.batch_alter_table('companies', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_companies_source'), ['source'], unique=False)
        batch_op.create_index(batch_op.f('ix_companies_workspace_id'), ['workspace_id'], unique=False)
        batch_op.create_index('ix_companies_workspace_industry', ['workspace_id', 'industry'], unique=False)
        batch_op.create_index('ix_companies_workspace_name', ['workspace_id', 'name'], unique=False)

    op.create_table('goals',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('category', sa.String(length=64), nullable=True),
    sa.Column('priority', sa.String(length=12), nullable=False),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('progress', sa.Integer(), nullable=False),
    sa.Column('target_date', sa.Date(), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False, comment="origin of the row; 'demo' rows are the only ones /demo/reset removes"),
    sa.CheckConstraint("priority IN ('low', 'medium', 'high', 'urgent')", name=op.f('ck_goals_priority')),
    sa.CheckConstraint("status IN ('active', 'completed', 'abandoned')", name=op.f('ck_goals_status')),
    sa.CheckConstraint('progress BETWEEN 0 AND 100', name=op.f('ck_goals_progress_range')),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_goals_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_goals'))
    )
    with op.batch_alter_table('goals', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_goals_source'), ['source'], unique=False)
        batch_op.create_index(batch_op.f('ix_goals_workspace_id'), ['workspace_id'], unique=False)
        batch_op.create_index('ix_goals_workspace_status', ['workspace_id', 'status'], unique=False)
        batch_op.create_index('ix_goals_workspace_target_date', ['workspace_id', 'target_date'], unique=False)

    op.create_table('notifications',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('kind', sa.String(length=32), nullable=False),
    sa.Column('severity', sa.String(length=12), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('body', sa.Text(), nullable=True),
    sa.Column('entity_type', sa.String(length=24), nullable=True),
    sa.Column('entity_id', sa.String(length=36), nullable=True),
    sa.Column('href', sa.String(length=300), nullable=True),
    sa.Column('read', sa.Boolean(), nullable=False),
    sa.Column('read_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('dedupe_key', sa.String(length=160), nullable=False),
    sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("kind IN ('task_overdue', 'task_due', 'milestone', 'reminder', 'project_stalled', 'system')", name=op.f('ck_notifications_kind')),
    sa.CheckConstraint("severity IN ('info', 'warning', 'critical')", name=op.f('ck_notifications_severity')),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_notifications_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_notifications')),
    sa.UniqueConstraint('dedupe_key', name='dedupe_key')
    )
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.create_index('ix_notifications_entity', ['entity_type', 'entity_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_notifications_workspace_id'), ['workspace_id'], unique=False)
        batch_op.create_index('ix_notifications_workspace_kind', ['workspace_id', 'kind'], unique=False)
        batch_op.create_index('ix_notifications_workspace_read_created', ['workspace_id', 'read', 'created_at'], unique=False)

    op.create_table('projects',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('slug', sa.String(length=180), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('category', sa.String(length=64), nullable=True),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('priority', sa.String(length=12), nullable=False),
    sa.Column('start_date', sa.Date(), nullable=True),
    sa.Column('target_date', sa.Date(), nullable=True),
    sa.Column('repository_url', sa.String(length=500), nullable=True),
    sa.Column('documentation_url', sa.String(length=500), nullable=True),
    sa.Column('next_action', sa.String(length=300), nullable=True),
    sa.Column('manual_progress', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False, comment="origin of the row; 'demo' rows are the only ones /demo/reset removes"),
    sa.CheckConstraint("priority IN ('low', 'medium', 'high', 'urgent')", name=op.f('ck_projects_priority')),
    sa.CheckConstraint("status IN ('backlog', 'planning', 'in_progress', 'on_hold', 'review', 'completed', 'archived')", name=op.f('ck_projects_status')),
    sa.CheckConstraint('manual_progress BETWEEN 0 AND 100', name=op.f('ck_projects_manual_progress_range')),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_projects_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_projects')),
    sa.UniqueConstraint('workspace_id', 'slug', name='workspace_slug')
    )
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_projects_source'), ['source'], unique=False)
        batch_op.create_index(batch_op.f('ix_projects_workspace_id'), ['workspace_id'], unique=False)
        batch_op.create_index('ix_projects_workspace_priority', ['workspace_id', 'priority'], unique=False)
        batch_op.create_index('ix_projects_workspace_status', ['workspace_id', 'status'], unique=False)
        batch_op.create_index('ix_projects_workspace_target_date', ['workspace_id', 'target_date'], unique=False)

    op.create_table('reminders',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('due_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('entity_type', sa.String(length=24), nullable=True),
    sa.Column('entity_id', sa.String(length=36), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('snoozed_until', sa.DateTime(timezone=True), nullable=True),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False, comment="origin of the row; 'demo' rows are the only ones /demo/reset removes"),
    sa.CheckConstraint("status IN ('pending', 'done')", name=op.f('ck_reminders_status')),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_reminders_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_reminders'))
    )
    with op.batch_alter_table('reminders', schema=None) as batch_op:
        batch_op.create_index('ix_reminders_entity', ['entity_type', 'entity_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_reminders_source'), ['source'], unique=False)
        batch_op.create_index(batch_op.f('ix_reminders_workspace_id'), ['workspace_id'], unique=False)
        batch_op.create_index('ix_reminders_workspace_status_due', ['workspace_id', 'status', 'due_at'], unique=False)

    op.create_table('tags',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=64), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_tags_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_tags')),
    sa.UniqueConstraint('workspace_id', 'name', name='workspace_name')
    )
    with op.batch_alter_table('tags', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_tags_workspace_id'), ['workspace_id'], unique=False)
        batch_op.create_index('ix_tags_workspace_name', ['workspace_id', 'name'], unique=False)

    op.create_table('workspace_members',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('user_id', sa.String(length=36), nullable=False),
    sa.Column('role', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("role IN ('owner', 'admin', 'member', 'viewer')", name=op.f('ck_workspace_members_role')),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], name=op.f('fk_workspace_members_user_id_users'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_workspace_members_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_workspace_members')),
    sa.UniqueConstraint('workspace_id', 'user_id', name='workspace_user')
    )
    with op.batch_alter_table('workspace_members', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_workspace_members_user_id'), ['user_id'], unique=False)
        batch_op.create_index('ix_workspace_members_user_role', ['user_id', 'role'], unique=False)
        batch_op.create_index(batch_op.f('ix_workspace_members_workspace_id'), ['workspace_id'], unique=False)

    op.create_table('contacts',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('name', sa.String(length=160), nullable=False),
    sa.Column('email', sa.String(length=255), nullable=True),
    sa.Column('phone', sa.String(length=40), nullable=True),
    sa.Column('title', sa.String(length=120), nullable=True),
    sa.Column('company_id', sa.String(length=36), nullable=True),
    sa.Column('location', sa.String(length=120), nullable=True),
    sa.Column('kind', sa.String(length=24), nullable=False),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False, comment="origin of the row; 'demo' rows are the only ones /demo/reset removes"),
    sa.CheckConstraint("kind IN ('client', 'prospect', 'partner', 'vendor', 'mentor', 'personal', 'other')", name=op.f('ck_contacts_kind')),
    sa.ForeignKeyConstraint(['company_id'], ['companies.id'], name=op.f('fk_contacts_company_id_companies'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_contacts_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_contacts'))
    )
    with op.batch_alter_table('contacts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_contacts_company_id'), ['company_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_contacts_source'), ['source'], unique=False)
        batch_op.create_index(batch_op.f('ix_contacts_workspace_id'), ['workspace_id'], unique=False)
        batch_op.create_index('ix_contacts_workspace_kind', ['workspace_id', 'kind'], unique=False)
        batch_op.create_index('ix_contacts_workspace_name', ['workspace_id', 'name'], unique=False)

    op.create_table('milestones',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('date', sa.Date(), nullable=False),
    sa.Column('status', sa.String(length=12), nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False, comment="origin of the row; 'demo' rows are the only ones /demo/reset removes"),
    sa.CheckConstraint("status IN ('open', 'done')", name=op.f('ck_milestones_status')),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_milestones_project_id_projects'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_milestones_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_milestones'))
    )
    with op.batch_alter_table('milestones', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_milestones_project_id'), ['project_id'], unique=False)
        batch_op.create_index('ix_milestones_project_status', ['project_id', 'status'], unique=False)
        batch_op.create_index(batch_op.f('ix_milestones_source'), ['source'], unique=False)
        batch_op.create_index('ix_milestones_workspace_date', ['workspace_id', 'date'], unique=False)
        batch_op.create_index(batch_op.f('ix_milestones_workspace_id'), ['workspace_id'], unique=False)

    op.create_table('notes',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=True),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('content', sa.Text(), nullable=True),
    sa.Column('category', sa.String(length=24), nullable=False),
    sa.Column('is_favorite', sa.Boolean(), nullable=False),
    sa.Column('word_count', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False, comment="origin of the row; 'demo' rows are the only ones /demo/reset removes"),
    sa.CheckConstraint("category IN ('technical', 'ai_ml', 'business_idea', 'meeting', 'project_doc', 'learning', 'startup', 'personal', 'resource')", name=op.f('ck_notes_category')),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_notes_project_id_projects'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_notes_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_notes'))
    )
    with op.batch_alter_table('notes', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_notes_project_id'), ['project_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_notes_source'), ['source'], unique=False)
        batch_op.create_index('ix_notes_workspace_category', ['workspace_id', 'category'], unique=False)
        batch_op.create_index('ix_notes_workspace_favorite', ['workspace_id', 'is_favorite'], unique=False)
        batch_op.create_index(batch_op.f('ix_notes_workspace_id'), ['workspace_id'], unique=False)
        batch_op.create_index('ix_notes_workspace_updated', ['workspace_id', 'updated_at'], unique=False)

    op.create_table('tasks',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('project_id', sa.String(length=36), nullable=True),
    sa.Column('parent_task_id', sa.String(length=36), nullable=True),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('description', sa.Text(), nullable=True),
    sa.Column('notes', sa.Text(), nullable=True),
    sa.Column('status', sa.String(length=16), nullable=False),
    sa.Column('priority', sa.String(length=12), nullable=False),
    sa.Column('due_date', sa.Date(), nullable=True),
    sa.Column('start_date', sa.Date(), nullable=True),
    sa.Column('estimated_minutes', sa.Integer(), nullable=True),
    sa.Column('actual_minutes', sa.Integer(), nullable=True),
    sa.Column('recurrence', sa.String(length=16), nullable=False),
    sa.Column('position', sa.Integer(), nullable=False),
    sa.Column('completed_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('source', sa.String(length=16), nullable=False, comment="origin of the row; 'demo' rows are the only ones /demo/reset removes"),
    sa.CheckConstraint("priority IN ('low', 'medium', 'high', 'urgent')", name=op.f('ck_tasks_priority')),
    sa.CheckConstraint("recurrence IN ('none', 'daily', 'weekly', 'fortnightly', 'monthly')", name=op.f('ck_tasks_recurrence')),
    sa.CheckConstraint("status IN ('todo', 'in_progress', 'blocked', 'done', 'dropped')", name=op.f('ck_tasks_status')),
    sa.CheckConstraint('actual_minutes >= 0', name=op.f('ck_tasks_actual_minutes_non_negative')),
    sa.CheckConstraint('estimated_minutes >= 0', name=op.f('ck_tasks_estimated_minutes_non_negative')),
    sa.CheckConstraint('position >= 0', name=op.f('ck_tasks_position_non_negative')),
    sa.ForeignKeyConstraint(['parent_task_id'], ['tasks.id'], name=op.f('fk_tasks_parent_task_id_tasks'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['project_id'], ['projects.id'], name=op.f('fk_tasks_project_id_projects'), ondelete='SET NULL'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_tasks_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_tasks'))
    )
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_tasks_due_date'), ['due_date'], unique=False)
        batch_op.create_index(batch_op.f('ix_tasks_parent_task_id'), ['parent_task_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_tasks_project_id'), ['project_id'], unique=False)
        batch_op.create_index('ix_tasks_project_position', ['project_id', 'position'], unique=False)
        batch_op.create_index('ix_tasks_project_status', ['project_id', 'status'], unique=False)
        batch_op.create_index(batch_op.f('ix_tasks_source'), ['source'], unique=False)
        batch_op.create_index('ix_tasks_workspace_due_date', ['workspace_id', 'due_date'], unique=False)
        batch_op.create_index(batch_op.f('ix_tasks_workspace_id'), ['workspace_id'], unique=False)
        batch_op.create_index('ix_tasks_workspace_priority', ['workspace_id', 'priority'], unique=False)
        batch_op.create_index('ix_tasks_workspace_status', ['workspace_id', 'status'], unique=False)

    op.create_table('contact_tags',
    sa.Column('contact_id', sa.String(length=36), nullable=False),
    sa.Column('tag_id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['contact_id'], ['contacts.id'], name=op.f('fk_contact_tags_contact_id_contacts'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tag_id'], ['tags.id'], name=op.f('fk_contact_tags_tag_id_tags'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('contact_id', 'tag_id', name=op.f('pk_contact_tags')),
    comment='contacts <-> tags'
    )
    with op.batch_alter_table('contact_tags', schema=None) as batch_op:
        batch_op.create_index('ix_contact_tags_tag_id', ['tag_id'], unique=False)

    op.create_table('note_relations',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('workspace_id', sa.String(length=36), nullable=False),
    sa.Column('note_id', sa.String(length=36), nullable=False),
    sa.Column('target_type', sa.String(length=24), nullable=False),
    sa.Column('target_id', sa.String(length=36), nullable=False),
    sa.Column('label', sa.String(length=64), nullable=True),
    sa.Column('created_by', sa.String(length=36), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("target_type IN ('task', 'note', 'project', 'milestone', 'contact', 'company', 'goal')", name=op.f('ck_note_relations_target_type')),
    sa.ForeignKeyConstraint(['note_id'], ['notes.id'], name=op.f('fk_note_relations_note_id_notes'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['workspace_id'], ['workspaces.id'], name=op.f('fk_note_relations_workspace_id_workspaces'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_note_relations')),
    sa.UniqueConstraint('note_id', 'target_type', 'target_id', name='note_target')
    )
    with op.batch_alter_table('note_relations', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_note_relations_note_id'), ['note_id'], unique=False)
        batch_op.create_index('ix_note_relations_target', ['target_type', 'target_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_note_relations_workspace_id'), ['workspace_id'], unique=False)

    op.create_table('note_tags',
    sa.Column('note_id', sa.String(length=36), nullable=False),
    sa.Column('tag_id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['note_id'], ['notes.id'], name=op.f('fk_note_tags_note_id_notes'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['tag_id'], ['tags.id'], name=op.f('fk_note_tags_tag_id_tags'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('note_id', 'tag_id', name=op.f('pk_note_tags')),
    comment='notes <-> tags'
    )
    with op.batch_alter_table('note_tags', schema=None) as batch_op:
        batch_op.create_index('ix_note_tags_tag_id', ['tag_id'], unique=False)

    op.create_table('task_dependencies',
    sa.Column('id', sa.String(length=36), nullable=False),
    sa.Column('task_id', sa.String(length=36), nullable=False),
    sa.Column('depends_on_task_id', sa.String(length=36), nullable=False),
    sa.Column('type', sa.String(length=24), nullable=False),
    sa.Column('lag_days', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
    sa.CheckConstraint("type IN ('finish_to_start', 'start_to_finish', 'finish_to_finish', 'start_to_start')", name=op.f('ck_task_dependencies_type')),
    sa.CheckConstraint('task_id <> depends_on_task_id', name=op.f('ck_task_dependencies_not_self')),
    sa.ForeignKeyConstraint(['depends_on_task_id'], ['tasks.id'], name=op.f('fk_task_dependencies_depends_on_task_id_tasks'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], name=op.f('fk_task_dependencies_task_id_tasks'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_task_dependencies')),
    sa.UniqueConstraint('task_id', 'depends_on_task_id', name='task_pair')
    )
    with op.batch_alter_table('task_dependencies', schema=None) as batch_op:
        batch_op.create_index('ix_task_dependencies_depends_on', ['depends_on_task_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_task_dependencies_task_id'), ['task_id'], unique=False)

    op.create_table('task_tags',
    sa.Column('task_id', sa.String(length=36), nullable=False),
    sa.Column('tag_id', sa.String(length=36), nullable=False),
    sa.ForeignKeyConstraint(['tag_id'], ['tags.id'], name=op.f('fk_task_tags_tag_id_tags'), ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['task_id'], ['tasks.id'], name=op.f('fk_task_tags_task_id_tasks'), ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('task_id', 'tag_id', name=op.f('pk_task_tags')),
    comment='tasks <-> tags'
    )
    with op.batch_alter_table('task_tags', schema=None) as batch_op:
        batch_op.create_index('ix_task_tags_tag_id', ['tag_id'], unique=False)



def downgrade() -> None:
    # tenancy -> work -> knowledge -> people -> signals
    with op.batch_alter_table('task_tags', schema=None) as batch_op:
        batch_op.drop_index('ix_task_tags_tag_id')

    op.drop_table('task_tags')
    with op.batch_alter_table('task_dependencies', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_task_dependencies_task_id'))
        batch_op.drop_index('ix_task_dependencies_depends_on')

    op.drop_table('task_dependencies')
    with op.batch_alter_table('note_tags', schema=None) as batch_op:
        batch_op.drop_index('ix_note_tags_tag_id')

    op.drop_table('note_tags')
    with op.batch_alter_table('note_relations', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_note_relations_workspace_id'))
        batch_op.drop_index('ix_note_relations_target')
        batch_op.drop_index(batch_op.f('ix_note_relations_note_id'))

    op.drop_table('note_relations')
    with op.batch_alter_table('contact_tags', schema=None) as batch_op:
        batch_op.drop_index('ix_contact_tags_tag_id')

    op.drop_table('contact_tags')
    with op.batch_alter_table('tasks', schema=None) as batch_op:
        batch_op.drop_index('ix_tasks_workspace_status')
        batch_op.drop_index('ix_tasks_workspace_priority')
        batch_op.drop_index(batch_op.f('ix_tasks_workspace_id'))
        batch_op.drop_index('ix_tasks_workspace_due_date')
        batch_op.drop_index(batch_op.f('ix_tasks_source'))
        batch_op.drop_index('ix_tasks_project_status')
        batch_op.drop_index('ix_tasks_project_position')
        batch_op.drop_index(batch_op.f('ix_tasks_project_id'))
        batch_op.drop_index(batch_op.f('ix_tasks_parent_task_id'))
        batch_op.drop_index(batch_op.f('ix_tasks_due_date'))

    op.drop_table('tasks')
    with op.batch_alter_table('notes', schema=None) as batch_op:
        batch_op.drop_index('ix_notes_workspace_updated')
        batch_op.drop_index(batch_op.f('ix_notes_workspace_id'))
        batch_op.drop_index('ix_notes_workspace_favorite')
        batch_op.drop_index('ix_notes_workspace_category')
        batch_op.drop_index(batch_op.f('ix_notes_source'))
        batch_op.drop_index(batch_op.f('ix_notes_project_id'))

    op.drop_table('notes')
    with op.batch_alter_table('milestones', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_milestones_workspace_id'))
        batch_op.drop_index('ix_milestones_workspace_date')
        batch_op.drop_index(batch_op.f('ix_milestones_source'))
        batch_op.drop_index('ix_milestones_project_status')
        batch_op.drop_index(batch_op.f('ix_milestones_project_id'))

    op.drop_table('milestones')
    with op.batch_alter_table('contacts', schema=None) as batch_op:
        batch_op.drop_index('ix_contacts_workspace_name')
        batch_op.drop_index('ix_contacts_workspace_kind')
        batch_op.drop_index(batch_op.f('ix_contacts_workspace_id'))
        batch_op.drop_index(batch_op.f('ix_contacts_source'))
        batch_op.drop_index(batch_op.f('ix_contacts_company_id'))

    op.drop_table('contacts')
    with op.batch_alter_table('workspace_members', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_workspace_members_workspace_id'))
        batch_op.drop_index('ix_workspace_members_user_role')
        batch_op.drop_index(batch_op.f('ix_workspace_members_user_id'))

    op.drop_table('workspace_members')
    with op.batch_alter_table('tags', schema=None) as batch_op:
        batch_op.drop_index('ix_tags_workspace_name')
        batch_op.drop_index(batch_op.f('ix_tags_workspace_id'))

    op.drop_table('tags')
    with op.batch_alter_table('reminders', schema=None) as batch_op:
        batch_op.drop_index('ix_reminders_workspace_status_due')
        batch_op.drop_index(batch_op.f('ix_reminders_workspace_id'))
        batch_op.drop_index(batch_op.f('ix_reminders_source'))
        batch_op.drop_index('ix_reminders_entity')

    op.drop_table('reminders')
    with op.batch_alter_table('projects', schema=None) as batch_op:
        batch_op.drop_index('ix_projects_workspace_target_date')
        batch_op.drop_index('ix_projects_workspace_status')
        batch_op.drop_index('ix_projects_workspace_priority')
        batch_op.drop_index(batch_op.f('ix_projects_workspace_id'))
        batch_op.drop_index(batch_op.f('ix_projects_source'))

    op.drop_table('projects')
    with op.batch_alter_table('notifications', schema=None) as batch_op:
        batch_op.drop_index('ix_notifications_workspace_read_created')
        batch_op.drop_index('ix_notifications_workspace_kind')
        batch_op.drop_index(batch_op.f('ix_notifications_workspace_id'))
        batch_op.drop_index('ix_notifications_entity')

    op.drop_table('notifications')
    with op.batch_alter_table('goals', schema=None) as batch_op:
        batch_op.drop_index('ix_goals_workspace_target_date')
        batch_op.drop_index('ix_goals_workspace_status')
        batch_op.drop_index(batch_op.f('ix_goals_workspace_id'))
        batch_op.drop_index(batch_op.f('ix_goals_source'))

    op.drop_table('goals')
    with op.batch_alter_table('companies', schema=None) as batch_op:
        batch_op.drop_index('ix_companies_workspace_name')
        batch_op.drop_index('ix_companies_workspace_industry')
        batch_op.drop_index(batch_op.f('ix_companies_workspace_id'))
        batch_op.drop_index(batch_op.f('ix_companies_source'))

    op.drop_table('companies')
    with op.batch_alter_table('activity_logs', schema=None) as batch_op:
        batch_op.drop_index('ix_activity_logs_workspace_project')
        batch_op.drop_index(batch_op.f('ix_activity_logs_workspace_id'))
        batch_op.drop_index('ix_activity_logs_workspace_created')
        batch_op.drop_index(batch_op.f('ix_activity_logs_project_id'))
        batch_op.drop_index('ix_activity_logs_entity')

    op.drop_table('activity_logs')
    with op.batch_alter_table('workspaces', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_workspaces_slug'))

    op.drop_table('workspaces')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_email'))

    op.drop_table('users')
