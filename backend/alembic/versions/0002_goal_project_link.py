"""Goals serve a project: add ``goals.project_id``.

Revision ID: 0002
Revises: 0001
Create Date: 2026-11-21 13:25:35

Additive only - the UI links a goal to the project it advances, so ``goals`` gains a
nullable ``project_id`` with the same shape ``tasks.project_id`` already has: an index
for the workspace-scoped lookups and ``ON DELETE SET NULL`` so deleting a project never
takes a goal down with it. No row is rewritten and no existing column is touched.

``op.batch_alter_table`` is what makes this portable: SQLite cannot add a foreign key to
an existing table, so batch mode rebuilds ``goals`` in one copy-and-swap (rows and ids
are preserved), while on PostgreSQL the batch wrapper emits a plain ``ALTER TABLE ... ADD
COLUMN`` plus ``CREATE INDEX`` and ``ADD CONSTRAINT ... FOREIGN KEY``.
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table('goals', schema=None) as batch_op:
        batch_op.add_column(sa.Column('project_id', sa.String(length=36), nullable=True))
        batch_op.create_index(batch_op.f('ix_goals_project_id'), ['project_id'], unique=False)
        batch_op.create_foreign_key(
            batch_op.f('fk_goals_project_id_projects'),
            'projects',
            ['project_id'],
            ['id'],
            ondelete='SET NULL',
        )


def downgrade() -> None:
    with op.batch_alter_table('goals', schema=None) as batch_op:
        batch_op.drop_constraint(batch_op.f('fk_goals_project_id_projects'), type_='foreignkey')
        batch_op.drop_index(batch_op.f('ix_goals_project_id'))
        batch_op.drop_column('project_id')
