Repo is LF (.gitattributes); Windows working trees may show CRLF warnings.

`.gitattributes` forces LF so Linux CI, App Service and Windows agree. On Windows the VCS may print "LF will be replaced by CRLF" warnings or show whole-file diffs if an editor rewrote line endings. Do not commit CRLF; keep editors on LF for this repo. Scripts that generate files (fixtures, docs) should write LF.
