import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireBridgeProjectAuth } from "../lib/bridge.js";
import {
  createChangeJob, discardLearningProposal, getLearningProposal, learningOverview,
  listLearningProposals, requestPublish, requestRollback
} from "../lib/learning/store.js";

const uuid=z.string().uuid();
const actor=z.object({userId:z.string().min(1).max(200),email:z.string().email()});
const status=z.enum(["pending","generating","ready_for_review","discarded","publishing","published","failed","rolled_back"]);

export const learningRoutes:FastifyPluginAsync=async(fastify)=>{
  fastify.get("/api/bridge/inbox/learning/overview",async(request)=>{
    const auth=requireBridgeProjectAuth(request);return {ok:true,data:await learningOverview(fastify.pg,auth.projectKey)};
  });
  fastify.get("/api/bridge/inbox/learning/proposals",async(request)=>{
    const auth=requireBridgeProjectAuth(request);const query=z.object({status:status.optional(),limit:z.coerce.number().int().min(1).max(200).optional()}).parse(request.query??{});
    return {ok:true,data:await listLearningProposals(fastify.pg,auth.projectKey,query)};
  });
  fastify.get("/api/bridge/inbox/learning/proposals/:id",async(request,reply)=>{
    const auth=requireBridgeProjectAuth(request);const id=uuid.parse((request.params as any).id);const row=await getLearningProposal(fastify.pg,auth.projectKey,id);
    if(!row)return reply.code(404).send({ok:false,error:"learning_proposal_not_found"});return {ok:true,data:row};
  });
  fastify.post("/api/bridge/inbox/learning/proposals/:id/apply",async(request,reply)=>{
    const auth=requireBridgeProjectAuth(request);const id=uuid.parse((request.params as any).id);const input=actor.parse(request.body);const row=await createChangeJob(fastify.pg,auth.projectKey,id,input);
    if(!row)return reply.code(409).send({ok:false,error:"learning_proposal_not_pending"});return reply.code(202).send({ok:true,data:row});
  });
  fastify.post("/api/bridge/inbox/learning/proposals/:id/discard",async(request,reply)=>{
    const auth=requireBridgeProjectAuth(request);const id=uuid.parse((request.params as any).id);const input=actor.extend({reason:z.string().trim().max(1000).default("")}).parse(request.body);const row=await discardLearningProposal(fastify.pg,auth.projectKey,id,input,input.reason);
    if(!row)return reply.code(409).send({ok:false,error:"learning_proposal_not_discardable"});return {ok:true,data:row};
  });
  fastify.post("/api/bridge/inbox/learning/proposals/:id/publish",async(request,reply)=>{
    const auth=requireBridgeProjectAuth(request);const id=uuid.parse((request.params as any).id);const input=actor.parse(request.body);const row=await requestPublish(fastify.pg,auth.projectKey,id,input);
    if(!row)return reply.code(409).send({ok:false,error:"learning_change_not_ready"});return reply.code(202).send({ok:true,data:row});
  });
  fastify.post("/api/bridge/inbox/learning/proposals/:id/rollback",async(request,reply)=>{
    const auth=requireBridgeProjectAuth(request);const id=uuid.parse((request.params as any).id);const input=actor.parse(request.body);const row=await requestRollback(fastify.pg,auth.projectKey,id,input);
    if(!row)return reply.code(409).send({ok:false,error:"learning_change_not_published"});return reply.code(202).send({ok:true,data:row});
  });
};
