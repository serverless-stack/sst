import {
  createSchema,
  createTableSchema,
  definePermissions,
  ExpressionBuilder,
  TableSchema,
  Row,
  NOBODY_CAN,
  ANYONE_CAN,
} from "@rocicorp/zero";

const userSchema = createTableSchema({
  tableName: "user",
  columns: {
    id: "string",
    name: "string",
    partner: "boolean",
  },
  primaryKey: "id",
});

const mediumSchema = createTableSchema({
  tableName: "medium",
  columns: {
    id: "string",
    name: "string",
  },
  primaryKey: "id",
});

const messageSchema = createTableSchema({
  tableName: "message",
  columns: {
    id: "string",
    senderID: "string",
    mediumID: "string",
    body: "string",
    timestamp: "number",
  },
  primaryKey: "id",
  relationships: {
    sender: {
      sourceField: "senderID",
      destSchema: userSchema,
      destField: "id",
    },
    medium: {
      sourceField: "mediumID",
      destSchema: mediumSchema,
      destField: "id",
    },
  },
});

export const schema = createSchema({
  version: 1,
  tables: {
    user: userSchema,
    medium: mediumSchema,
    message: messageSchema,
  },
});

export type Schema = typeof schema;
export type Message = Row<typeof messageSchema>;
export type Medium = Row<typeof mediumSchema>;
export type User = Row<typeof schema.tables.user>;

// The contents of your decoded JWT.
type AuthData = {
  sub: string | null;
};

export const permissions = definePermissions<AuthData, Schema>(schema, () => {
  const allowIfLoggedIn = (
    authData: AuthData,
    { cmpLit }: ExpressionBuilder<TableSchema>
  ) => cmpLit(authData.sub, "IS NOT", null);

  const allowIfMessageSender = (
    authData: AuthData,
    { cmp }: ExpressionBuilder<typeof messageSchema>
  ) => cmp("senderID", "=", authData.sub ?? "");

  return {
    medium: {
      row: {
        insert: NOBODY_CAN,
        update: {
          preMutation: NOBODY_CAN,
        },
        delete: NOBODY_CAN,
      },
    },
    user: {
      row: {
        insert: NOBODY_CAN,
        update: {
          preMutation: NOBODY_CAN,
        },
        delete: NOBODY_CAN,
      },
    },
    message: {
      row: {
        // anyone can insert
        insert: ANYONE_CAN,
        // only sender can edit their own messages
        update: {
          preMutation: [allowIfMessageSender],
        },
        // must be logged in to delete
        delete: [allowIfLoggedIn],
      },
    },
  };
});
