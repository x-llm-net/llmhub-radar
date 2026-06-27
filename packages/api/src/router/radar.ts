import {
  AddRadarTokenProbeInput,
  CreateRadarPoolInput,
  DiscoverRadarModelsForPoolInput,
  DiscoverRadarModelsInput,
  DeleteRadarCredentialInput,
  GetRadarPoolInput,
  ListRadarPoolsInput,
  RecordRadarProbeRunInput,
  UpdateRadarPoolInput,
  UpdateRadarTokenProbeInput,
  addRadarTokenProbe,
  createRadarPool,
  deleteRadarCredential,
  discoverRadarModelsForPool,
  discoverRadarModels,
  getRadarPool,
  listRadarPools,
  recordRadarProbeRun,
  updateRadarPool,
  updateRadarTokenProbe,
} from "@openstatus/services/radar";

import { toServiceCtx, toTRPCError } from "../service-adapter";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const radarRouter = createTRPCRouter({
  listPools: protectedProcedure
    .input(ListRadarPoolsInput.optional())
    .query(async ({ ctx, input }) => {
      try {
        return await listRadarPools({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  getPool: protectedProcedure
    .input(GetRadarPoolInput)
    .query(async ({ ctx, input }) => {
      try {
        return await getRadarPool({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  createPool: protectedProcedure
    .input(CreateRadarPoolInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await createRadarPool({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  updatePool: protectedProcedure
    .input(UpdateRadarPoolInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateRadarPool({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  addTokenProbe: protectedProcedure
    .input(AddRadarTokenProbeInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await addRadarTokenProbe({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  updateTokenProbe: protectedProcedure
    .input(UpdateRadarTokenProbeInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await updateRadarTokenProbe({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  deleteCredential: protectedProcedure
    .input(DeleteRadarCredentialInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await deleteRadarCredential({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  discoverModels: protectedProcedure
    .input(DiscoverRadarModelsInput)
    .query(async ({ ctx, input }) => {
      try {
        return await discoverRadarModels({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  discoverModelsForPool: protectedProcedure
    .input(DiscoverRadarModelsForPoolInput)
    .query(async ({ ctx, input }) => {
      try {
        return await discoverRadarModelsForPool({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  recordProbeRun: protectedProcedure
    .input(RecordRadarProbeRunInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await recordRadarProbeRun({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),
});
