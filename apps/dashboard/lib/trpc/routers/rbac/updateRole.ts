import { db, eq, schema } from "@/lib/db";
import { ingestAuditLogs } from "@/lib/tinybird";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auth, t } from "../../trpc";

const nameSchema = z
  .string()
  .min(3)
  .regex(/^[a-zA-Z0-9_:\-\.\*]+$/, {
    message:
      "Must be at least 3 characters long and only contain alphanumeric, colons, periods, dashes and underscores",
  });

export const updateRole = t.procedure
  .use(auth)
  .input(
    z.object({
      id: z.string(),
      name: nameSchema,
      description: z.string().nullable(),
    }),
  )
  .mutation(async ({ input, ctx }) => {
    const workspace = await db.query.workspaces.findFirst({
      where: (table, { eq }) => eq(table.tenantId, ctx.tenant.id),
      with: {
        roles: {
          where: (table, { eq }) => eq(table.id, input.id),
        },
      },
    });

    if (!workspace) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message:
          "We are unable to find the correct workspace. Please contact support using support@unkey.dev.",
      });
    }
    if (workspace.roles.length === 0) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message:
          "We are unable to find the correct role. Please contact support using support@unkey.dev.",
      });
    }
    await db
      .update(schema.roles)
      .set(input)
      .where(eq(schema.roles.id, input.id))
      .catch((_err) => {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "We are unable to update the role. Please contact support using support@unkey.dev.",
        });
      });

    await ingestAuditLogs({
      workspaceId: workspace.id,
      actor: { type: "user", id: ctx.user.id },
      event: "role.update",
      description: `Updated role ${input.id}`,
      resources: [
        {
          type: "role",
          id: input.id,
        },
      ],
      context: {
        location: ctx.audit.location,
        userAgent: ctx.audit.userAgent,
      },
    });
  });
