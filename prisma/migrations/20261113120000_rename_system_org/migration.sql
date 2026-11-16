-- T19：系统组织改名 Nova Collab → Weavi Space（只改仍是默认名的那一行，不动用户改过的名字）
UPDATE "organizations" SET "name" = 'Weavi Space' WHERE "id" = 'org_nova_collab' AND "name" = 'Nova Collab';
