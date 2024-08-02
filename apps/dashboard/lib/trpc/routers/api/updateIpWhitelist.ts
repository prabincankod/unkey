import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { db, eq, schema } from "@/lib/db";
import { ingestAuditLogs } from "@/lib/tinybird";
import { auth, t } from "../../trpc";

export const updateApiIpWhitelist = t.procedure
  .use(auth)
  .input(
    z.object({
      ipWhitelist: z
        .string()
        .transform((s, ctx) => {
          if (s === "") {
            return null;
          }
          const ips = s.split(/,|\n/).map((ip) => ip.trim());
          const parsedIps = z.array(z.string().ip()).safeParse(ips);
          if (!parsedIps.success) {
            ctx.addIssue(parsedIps.error.issues[0]);
            return z.NEVER;
          }
          return parsedIps.data;
        })
        .nullable(),
      apiId: z.string(),
      workspaceId: z.string(),
    }),
  )
  .mutation(async ({ input, ctx }) => {
    const api = await db.query.apis.findFirst({
      where: (table, { eq }) => eq(table.id, input.apiId),
      with: {
        workspace: true,
      },
    });
    if (!api || api.workspace.tenantId !== ctx.tenant.id) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message:
          "We are unable to find the correct API. Please contact support using support@unkey.dev.",
      });
    }

    const newIpWhitelist = input.ipWhitelist === null ? null : input.ipWhitelist.join(",");

    await db
      .update(schema.apis)
      .set({
        ipWhitelist: newIpWhitelist,
      })
      .where(eq(schema.apis.id, input.apiId))
      .catch((_err) => {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "We are unable to update the API whitelist. Please contact support using support@unkey.dev",
        });
      });

    await ingestAuditLogs({
      workspaceId: api.workspace.id,
      actor: {
        type: "user",
        id: ctx.user.id,
      },
      event: "api.update",
      description: `Changed ${api.id} IP whitelist from ${api.ipWhitelist} to ${newIpWhitelist}`,
      resources: [
        {
          type: "api",
          id: api.id,
        },
      ],
      context: {
        location: ctx.audit.location,
        userAgent: ctx.audit.userAgent,
      },
    });
  });
