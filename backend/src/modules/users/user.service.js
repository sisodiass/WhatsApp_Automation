import { prisma } from "../../shared/prisma.js";

export function findUserByEmail(email) {
  return prisma.user.findUnique({ where: { email: email.toLowerCase() } });
}

export function findUserById(id) {
  return prisma.user.findUnique({ where: { id } });
}

export function recordLogin(id) {
  return prisma.user.update({
    where: { id },
    data: { lastLoginAt: new Date() },
  });
}

export function publicUser(user) {
  if (!user) return null;
  const { passwordHash: _ph, ...rest } = user;
  return rest;
}
