import { z } from "zod"

export const UserProfileSchema = z.object({
  id: z.string(),
  email: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  groups: z.array(z.string()),
  language: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
  isDemoUser: z.boolean(),
  recentSearches: z.array(z.string()).optional(),
})

export const UpdateProfileRequestSchema = z.object({
  language: z.string().optional(),
  recentSearches: z.array(z.string()).max(10).optional(),
})

export const UserPreferencesSchema = z.object({
  id: z.string(),
  userId: z.string(),
  uiPreferences: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const UpdatePreferencesRequestSchema = z.object({
  uiPreferences: z.record(z.string(), z.unknown()).optional(),
})

export const CustomBenchmarksResponseSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())),
})

export const CustomTimeframesResponseSchema = z.object({
  items: z.array(z.record(z.string(), z.unknown())),
})

export const OnboardingStatusSchema = z.object({
  completed: z.boolean(),
  currentStep: z.string().nullable().optional(),
})

export const OnboardingDraftSchema = z.object({
  draft: z.unknown().nullable(),
})

export const ErrorResponseSchema = z.object({
  error: z.string(),
  message: z.string(),
  statusCode: z.number().optional(),
})
