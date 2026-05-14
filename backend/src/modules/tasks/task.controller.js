import { z } from "zod";
import { asyncHandler, BadRequest } from "../../shared/errors.js";
import { getDefaultTenantId } from "../../shared/tenant.js";
import {
  createTask,
  deleteTask,
  getTask,
  listTasks,
  updateTask,
} from "./task.service.js";

const taskStatus = z.enum(["OPEN", "DONE", "CANCELLED"]);

const baseSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).nullable().optional(),
  dueAt: z.coerce.date().nullable().optional(),
  status: taskStatus.optional(),
  assignedToId: z.string().nullable().optional(),
  leadId: z.string().nullable().optional(),
});

export const list = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const result = await listTasks(tenantId, {
    status: req.query.status?.toString(),
    assignedToId: req.query.assignedToId?.toString(),
    leadId: req.query.leadId?.toString(),
    overdue: req.query.overdue === "true",
    page: req.query.page,
    pageSize: req.query.pageSize,
  });
  res.json(result);
});

export const getOne = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  const t = await getTask(tenantId, req.params.id);
  res.json(t);
});

export const create = asyncHandler(async (req, res) => {
  const parsed = baseSchema.safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid task payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const t = await createTask(tenantId, parsed.data, req.user?.id);
  res.status(201).json(t);
});

export const patch = asyncHandler(async (req, res) => {
  const parsed = baseSchema.partial().safeParse(req.body);
  if (!parsed.success) throw BadRequest("invalid task payload", parsed.error.flatten());
  const tenantId = await getDefaultTenantId();
  const t = await updateTask(tenantId, req.params.id, parsed.data, req.user?.id);
  res.json(t);
});

export const remove = asyncHandler(async (req, res) => {
  const tenantId = await getDefaultTenantId();
  await deleteTask(tenantId, req.params.id);
  res.status(204).end();
});
