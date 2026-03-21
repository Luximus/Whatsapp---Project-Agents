import "fastify";

export type AuthUser = {
  uid: string;
  email?: string;
  name?: string;
  picture?: string | null;
};

declare module "fastify" {
  interface FastifyInstance {
    pg: import("pg").Pool;
    authenticate: (request: any, reply: any) => Promise<void>;
  }

  interface FastifyRequest {
    user?: AuthUser;
  }
}
