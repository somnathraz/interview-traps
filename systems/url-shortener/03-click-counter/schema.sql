DROP TABLE IF EXISTS links;

CREATE TABLE links (
  code    TEXT   PRIMARY KEY,
  dest    TEXT   NOT NULL,
  clicks  BIGINT NOT NULL DEFAULT 0
);

-- the link an influencer is about to share
INSERT INTO links (code, dest) VALUES ('launch', 'https://example.com/launch');
-- an unrelated link, to see if the storm on /launch slows everyone else down
INSERT INTO links (code, dest) VALUES ('docs', 'https://example.com/docs');
