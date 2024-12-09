import {
  useQuery,
  useClient,
  createRequest,
  RequestPolicy,
  OperationResult,
  UseMutationState,
  OperationContext,
  UseMutationResponse,
} from "urql";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  QueryResult,
  QueryGenqlSelection,
  MutationResult,
  MutationGenqlSelection,
  generateQueryOp,
  generateMutationOp,
} from "./genql";

import { pipe, toPromise } from "wonka";

export function useTypedQuery<Query extends QueryGenqlSelection>(opts: {
  query: Query;
  pause?: boolean;
  requestPolicy?: RequestPolicy;
  context?: Partial<OperationContext>;
}) {
  const { query, variables } = generateQueryOp(opts.query);
  return useQuery<QueryResult<Query>>({
    ...opts,
    query,
    variables,
  });
}

const initialState = {
  stale: false,
  fetching: false,
  data: undefined,
  error: undefined,
  operation: undefined,
  extensions: undefined,
};

export function useTypedMutation<
  Variables extends Record<string, any>,
  Mutation extends MutationGenqlSelection,
  Data extends MutationResult<Mutation>
>(
  builder: (vars: Variables) => Mutation,
  opts?: Partial<OperationContext>
): UseMutationResponse<Data, Variables> {
  const client = useClient();
  const isMounted = useRef(true);
  const [state, setState] =
    useState<UseMutationState<Data, Variables>>(initialState);
  const executeMutation = useCallback(
    (
      vars?: Variables,
      context?: Partial<OperationContext>
    ): Promise<OperationResult<Data, Variables>> => {
      setState({ ...initialState, fetching: true });
      const buildArgs = vars || ({} as Variables);
      const built = builder(buildArgs);
      const { query, variables } = generateMutationOp(built);
      return pipe(
        client.executeMutation<Data, Variables>(
          createRequest(query, variables as Variables),
          { ...opts, ...context }
        ),
        toPromise
      ).then((result: OperationResult<Data, Variables>) => {
        if (isMounted.current) {
          setState({
            fetching: false,
            stale: !!result.stale,
            data: result.data,
            error: result.error,
            extensions: result.extensions,
            operation: result.operation,
          });
        }
        return result;
      });
    },
    [state, setState]
  );

  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  return [state, executeMutation];
}
