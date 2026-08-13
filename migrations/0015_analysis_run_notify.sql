CREATE OR REPLACE FUNCTION notify_analysis_run_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_notify('askme_analysis_run',json_build_object('runId',NEW.id,'version',NEW.version)::text);
  RETURN NEW;
END;
$$;

CREATE TRIGGER analysis_runs_notify_version
AFTER INSERT OR UPDATE OF version ON analysis_runs
FOR EACH ROW
EXECUTE FUNCTION notify_analysis_run_version();
