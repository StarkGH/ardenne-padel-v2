import type { AcademyActorType, AcademyCourseType, AcademyLessonStatus, PrismaClient } from "@prisma/client";

export interface CreateAvailabilityInput {
  actorType: AcademyActorType;
  teacherId?: string;
  studentId?: string;
  startAt: Date;
  endAt: Date;
  recurrence?: unknown;
  source?: string;
}

export class AcademyRepository {
  constructor(private readonly db: PrismaClient) {}

  // --- Disponibilités ---------------------------------------------------

  createAvailability(input: CreateAvailabilityInput) {
    return this.db.academyAvailability.create({
      data: {
        actorType: input.actorType,
        teacherId: input.teacherId,
        studentId: input.studentId,
        startAt: input.startAt,
        endAt: input.endAt,
        recurrence: input.recurrence as never,
        source: input.source ?? "MANUAL",
      },
    });
  }

  findAvailabilityById(id: string) {
    return this.db.academyAvailability.findUnique({ where: { id } });
  }

  listTeacherAvailability(teacherId: string, from: Date, to: Date) {
    return this.db.academyAvailability.findMany({
      where: { actorType: "TEACHER", teacherId, status: "ACTIVE", startAt: { lt: to }, endAt: { gt: from } },
      orderBy: { startAt: "asc" },
    });
  }

  listStudentAvailability(studentId: string, from: Date, to: Date) {
    return this.db.academyAvailability.findMany({
      where: { actorType: "STUDENT", studentId, status: "ACTIVE", startAt: { lt: to }, endAt: { gt: from } },
      orderBy: { startAt: "asc" },
    });
  }

  deleteAvailability(id: string) {
    return this.db.academyAvailability.delete({ where: { id } });
  }

  // --- Élèves / invitations ----------------------------------------------

  findStudentByEmail(email: string) {
    return this.db.academyStudent.findFirst({ where: { email } });
  }

  findStudentById(id: string) {
    return this.db.academyStudent.findUnique({ where: { id } });
  }

  createStudent(data: { firstName: string; lastName?: string; email: string; phone?: string }) {
    return this.db.academyStudent.create({ data });
  }

  createInvitation(input: { studentId: string; tokenHash: string; expiresAt: Date }) {
    return this.db.academyInvitation.create({ data: input });
  }

  findInvitationByTokenHash(tokenHash: string) {
    return this.db.academyInvitation.findUnique({ where: { tokenHash }, include: { student: true } });
  }

  revokeInvitation(id: string) {
    return this.db.academyInvitation.update({ where: { id }, data: { revokedAt: new Date() } });
  }

  markInvitationUsed(id: string) {
    return this.db.academyInvitation.update({ where: { id }, data: { usedAt: new Date() } });
  }

  revokeActiveInvitationsForStudent(studentId: string) {
    return this.db.academyInvitation.updateMany({
      where: { studentId, revokedAt: null, usedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // --- Demandes de cours ---------------------------------------------------

  createCourseRequest(input: { studentId: string; requestedHours: number; courseType: AcademyCourseType }) {
    return this.db.academyCourseRequest.create({ data: input });
  }

  listCourseRequestsForStudent(studentId: string) {
    return this.db.academyCourseRequest.findMany({ where: { studentId }, orderBy: { createdAt: "desc" } });
  }

  // --- Cours (propositions/confirmations) ---------------------------------

  createLesson(input: { teacherId: string; startAt: Date; endAt: Date; studentIds: string[]; status: AcademyLessonStatus }) {
    return this.db.academyLesson.create({
      data: {
        teacherId: input.teacherId,
        startAt: input.startAt,
        endAt: input.endAt,
        status: input.status,
        participants: { createMany: { data: input.studentIds.map((studentId) => ({ studentId })) } },
      },
      include: { participants: { include: { student: true } }, teacher: true },
    });
  }

  findLessonById(id: string) {
    return this.db.academyLesson.findUnique({ where: { id }, include: { participants: { include: { student: true } }, teacher: true } });
  }

  updateLessonStatus(id: string, status: AcademyLessonStatus) {
    return this.db.academyLesson.update({ where: { id }, data: { status } });
  }

  listLessonsForTeacher(teacherId: string, from: Date, to: Date) {
    return this.db.academyLesson.findMany({
      where: { teacherId, startAt: { lt: to }, endAt: { gt: from } },
      include: { participants: { include: { student: true } } },
      orderBy: { startAt: "asc" },
    });
  }

  listLessonsForStudent(studentId: string) {
    return this.db.academyLesson.findMany({
      where: { participants: { some: { studentId } } },
      include: { participants: { include: { student: true } }, teacher: true },
      orderBy: { startAt: "asc" },
    });
  }
}
