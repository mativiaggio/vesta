import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm'
import { db } from '../../../../../packages/database/src/client.js'
import { workspace, workspaceMembership } from '../../../../../packages/database/src/schema.js'
import { workspaceSchema, type Workspace } from '../../../../../packages/workspaces/src/contract.js'

const pageSize = 50

export async function listWorkspacePageForUser(userId: string, offset: number) {
  const rows = await db
    .select({
      id: workspace.id,
      name: workspace.name,
      accentColor: workspace.accentColor,
      icon: workspace.icon,
      lastAccessedAt: workspaceMembership.lastAccessedAt,
    })
    .from(workspaceMembership)
    .innerJoin(workspace, eq(workspace.id, workspaceMembership.workspaceId))
    .where(and(
      eq(workspaceMembership.userId, userId),
      isNull(workspaceMembership.deletedAt),
      isNull(workspace.deletedAt),
    ))
    .orderBy(asc(workspaceMembership.createdAt), asc(workspaceMembership.id))
    .limit(pageSize + 1)
    .offset(offset)

  const [lastWorkspace] = await db
    .select({ id: workspace.id })
    .from(workspaceMembership)
    .innerJoin(workspace, eq(workspace.id, workspaceMembership.workspaceId))
    .where(and(
      eq(workspaceMembership.userId, userId),
      isNull(workspaceMembership.deletedAt),
      isNull(workspace.deletedAt),
    ))
    .orderBy(sql`${workspaceMembership.lastAccessedAt} DESC NULLS LAST`, desc(workspaceMembership.createdAt))
    .limit(1)

  const hasMore = rows.length > pageSize
  const page = rows.slice(0, pageSize)
  const lastWorkspaceInPage = lastWorkspace && page.some((row) => row.id === lastWorkspace.id)
  const results = lastWorkspace && !lastWorkspaceInPage
    ? [...page, ...(await db
      .select({
        id: workspace.id,
        name: workspace.name,
        accentColor: workspace.accentColor,
        icon: workspace.icon,
        lastAccessedAt: workspaceMembership.lastAccessedAt,
      })
      .from(workspaceMembership)
      .innerJoin(workspace, eq(workspace.id, workspaceMembership.workspaceId))
      .where(and(
        eq(workspaceMembership.userId, userId),
        eq(workspaceMembership.workspaceId, lastWorkspace.id),
        isNull(workspaceMembership.deletedAt),
        isNull(workspace.deletedAt),
      ))
      .limit(1))]
    : page

  return {
    workspaces: results.map((row) => workspaceSchema.parse({
      ...row,
      lastAccessedAt: row.lastAccessedAt?.toISOString() ?? null,
    })),
    lastWorkspaceId: lastWorkspace?.id ?? null,
    nextOffset: hasMore ? offset + pageSize : null,
  }
}

export async function createWorkspaceForUser(
  userId: string,
  input: { name: string; accentColor: Workspace['accentColor']; icon: Workspace['icon'] },
): Promise<Workspace> {
  const now = new Date()
  return db.transaction(async (transaction) => {
    const [created] = await transaction.insert(workspace).values({
      id: crypto.randomUUID(),
      name: input.name,
      accentColor: input.accentColor,
      icon: input.icon,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: workspace.id, name: workspace.name, accentColor: workspace.accentColor, icon: workspace.icon })

    await transaction.insert(workspaceMembership).values({
      id: crypto.randomUUID(),
      workspaceId: created.id,
      userId,
      role: 'owner',
      lastAccessedAt: now,
      createdAt: now,
      updatedAt: now,
    })

    return workspaceSchema.parse({ ...created, lastAccessedAt: now.toISOString() })
  })
}

export async function activateWorkspaceForUser(userId: string, workspaceId: string): Promise<boolean> {
  const [membership] = await db
    .select({ id: workspaceMembership.id })
    .from(workspaceMembership)
    .innerJoin(workspace, eq(workspace.id, workspaceMembership.workspaceId))
    .where(and(
      eq(workspaceMembership.workspaceId, workspaceId),
      eq(workspaceMembership.userId, userId),
      isNull(workspaceMembership.deletedAt),
      isNull(workspace.deletedAt),
    ))
    .limit(1)

  if (!membership) return false

  const now = new Date()
  await db.update(workspaceMembership)
    .set({ lastAccessedAt: now, updatedAt: now })
    .where(and(eq(workspaceMembership.id, membership.id), isNull(workspaceMembership.deletedAt)))
  return true
}
