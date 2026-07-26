import {
  AddRadarTokenProbeInput,
  createPermanentListingOrder,
  CreateRadarPoolInput,
  DiscoverRadarModelsForPoolInput,
  DiscoverRadarModelsInput,
  DeleteRadarCredentialInput,
  GetRadarPoolInput,
  ListClaimableRadarPoolsInput,
  ListRadarClaimApplicationsInput,
  ListRadarOwnerCandidatesInput,
  ListRadarOrdersInput,
  ListRadarPoolsInput,
  ListRadarVerificationApplicationsInput,
  RecordRadarProbeRunInput,
  ReviewRadarClaimApplicationInput,
  ReviewRadarOrderInput,
  ReviewRadarVerificationApplicationInput,
  SubmitRadarClaimApplicationInput,
  SubmitRadarOrderReceiptInput,
  SubmitRadarVerificationApplicationInput,
  TransferRadarPoolOwnershipInput,
  UpdateRadarPoolInput,
  UpdateRadarTokenProbeInput,
  addRadarTokenProbe,
  createRadarPool,
  deleteRadarCredential,
  discoverRadarModelsForPool,
  discoverRadarModels,
  getRadarPool,
  getRadarVerificationOverview,
  listRadarClaimApplications,
  listRadarVerificationApplications,
  listClaimableRadarPools,
  listRadarOwnerCandidates,
  listRadarOrders,
  listRadarPools,
  recordRadarProbeRun,
  reviewRadarClaimApplication,
  reviewRadarOrder,
  reviewRadarVerificationApplication,
  submitRadarClaimApplication,
  submitRadarOrderReceipt,
  submitRadarVerificationApplication,
  transferRadarPoolOwnership,
  updateRadarPool,
  updateRadarTokenProbe,
} from "@openstatus/services/radar";

import { toServiceCtx, toTRPCError } from "../service-adapter";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const radarRouter = createTRPCRouter({
  orders: protectedProcedure
    .input(ListRadarOrdersInput.optional())
    .query(async ({ ctx, input }) => {
      try {
        return await listRadarOrders({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  createPermanentOrder: protectedProcedure.mutation(async ({ ctx }) => {
    try {
      return await createPermanentListingOrder({ ctx: toServiceCtx(ctx) });
    } catch (err) {
      toTRPCError(err);
    }
  }),

  submitOrderReceipt: protectedProcedure
    .input(SubmitRadarOrderReceiptInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await submitRadarOrderReceipt({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  reviewOrder: protectedProcedure
    .input(ReviewRadarOrderInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await reviewRadarOrder({ ctx: toServiceCtx(ctx), input });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  verificationOverview: protectedProcedure.query(async ({ ctx }) => {
    try {
      return await getRadarVerificationOverview({ ctx: toServiceCtx(ctx) });
    } catch (err) {
      toTRPCError(err);
    }
  }),

  submitVerification: protectedProcedure
    .input(SubmitRadarVerificationApplicationInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await submitRadarVerificationApplication({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  verificationApplications: protectedProcedure
    .input(ListRadarVerificationApplicationsInput.optional())
    .query(async ({ ctx, input }) => {
      try {
        return await listRadarVerificationApplications({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  reviewVerification: protectedProcedure
    .input(ReviewRadarVerificationApplicationInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await reviewRadarVerificationApplication({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  ownerCandidates: protectedProcedure
    .input(ListRadarOwnerCandidatesInput.optional())
    .query(async ({ ctx, input }) => {
      try {
        return await listRadarOwnerCandidates({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

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

  listClaimablePools: protectedProcedure
    .input(ListClaimableRadarPoolsInput.optional())
    .query(async ({ ctx, input }) => {
      try {
        return await listClaimableRadarPools({
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

  transferOwnership: protectedProcedure
    .input(TransferRadarPoolOwnershipInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await transferRadarPoolOwnership({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  claimApplications: protectedProcedure
    .input(ListRadarClaimApplicationsInput.optional())
    .query(async ({ ctx, input }) => {
      try {
        return await listRadarClaimApplications({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  submitClaim: protectedProcedure
    .input(SubmitRadarClaimApplicationInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await submitRadarClaimApplication({
          ctx: toServiceCtx(ctx),
          input,
        });
      } catch (err) {
        toTRPCError(err);
      }
    }),

  reviewClaim: protectedProcedure
    .input(ReviewRadarClaimApplicationInput)
    .mutation(async ({ ctx, input }) => {
      try {
        return await reviewRadarClaimApplication({
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
