declare module "sql.js" {
  export type BindParams = Array<string | number | null>;

  export interface Statement {
    run(params?: BindParams): void;
    free(): void;
  }

  export interface QueryExecResult {
    columns: string[];
    values: Array<Array<string | number | null>>;
  }

  export interface Database {
    run(sql: string): void;
    prepare(sql: string): Statement;
    exec(sql: string): QueryExecResult[];
    export(): Uint8Array;
  }

  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | Uint8Array) => Database;
  }

  export interface InitSqlJsOptions {
    locateFile?: (file: string) => string;
  }

  export default function initSqlJs(options?: InitSqlJsOptions): Promise<SqlJsStatic>;
}
