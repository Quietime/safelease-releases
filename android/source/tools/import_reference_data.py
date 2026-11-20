"""Rebuild the bundled public reference database. Python 3.10+, stdlib only.

Inputs are official CSV snapshots and a reviewed catalogue. No tenant data is read.
Source CSV rows are retained individually; identical HDB rows may represent separate
approvals, because the source does not expose a unit or transaction identifier.
"""
import argparse,csv,hashlib,json,pathlib,sqlite3

def main():
 p=argparse.ArgumentParser();p.add_argument('--cea',required=True);p.add_argument('--hdb',required=True);p.add_argument('--catalog',required=True);p.add_argument('--out',required=True);a=p.parse_args()
 out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
 catalog=json.loads(pathlib.Path(a.catalog).read_text(encoding='utf-8'))
 dbpath=out/'reference.db'
 if dbpath.exists():dbpath.unlink()
 db=sqlite3.connect(dbpath)
 db.executescript('''PRAGMA user_version=2;
 CREATE TABLE agents(reg TEXT PRIMARY KEY,name TEXT NOT NULL,start_date TEXT,end_date TEXT,agency TEXT,licence TEXT,source_id TEXT);
 CREATE INDEX agents_name ON agents(name COLLATE NOCASE);
 CREATE INDEX agents_agency ON agents(agency COLLATE NOCASE);
 CREATE TABLE rentals(id INTEGER PRIMARY KEY,month TEXT,town TEXT,block TEXT,street TEXT,type TEXT,rent INTEGER,source_id TEXT);
 CREATE INDEX rentals_town_month ON rentals(town,month DESC);
 CREATE INDEX rentals_month ON rentals(month DESC);
 CREATE TABLE listings(id TEXT PRIMARY KEY,title TEXT,area TEXT,type TEXT,rent INTEGER,url TEXT,source_id TEXT,accessed TEXT,status TEXT);
 CREATE TABLE guides(id TEXT PRIMARY KEY,category TEXT,title_en TEXT,title_zh TEXT,body_en TEXT,body_zh TEXT,url TEXT,publisher TEXT,accessed TEXT);
 CREATE TABLE community(id TEXT PRIMARY KEY,title_en TEXT,title_zh TEXT,body_en TEXT,body_zh TEXT,url TEXT,platform TEXT,accessed TEXT);
 CREATE TABLE sources(id TEXT PRIMARY KEY,json TEXT NOT NULL);
 CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 ''')
 with open(a.cea,encoding='utf-8-sig',newline='') as f:
  rows=list(csv.DictReader(f))
  assert len(rows)>=500
  for r in rows:
   assert r['registration_no'] and r['salesperson_name']
   db.execute('INSERT INTO agents VALUES(?,?,?,?,?,?,?)',(r['registration_no'],r['salesperson_name'],r['registration_start_date'],r['registration_end_date'],r['estate_agent_name'],r['estate_agent_license_no'],'cea'))
 with open(a.hdb,encoding='utf-8-sig',newline='') as f:
  rentals=list(csv.DictReader(f))
  db.executemany('INSERT INTO rentals VALUES(?,?,?,?,?,?,?,?)',((i,r['rent_approval_date'],r['town'],r['block'],r['street_name'],r['flat_type'],int(r['monthly_rent']),'hdb') for i,r in enumerate(rentals,1)))
 for r in catalog['listings']:
  db.execute('INSERT INTO listings VALUES(?,?,?,?,?,?,?,?,?)',tuple(r[k] for k in ['id','title','area','type','rent','url','source_id','accessed','status']))
 for r in catalog['guides']:
  db.execute('INSERT INTO guides VALUES(?,?,?,?,?,?,?,?,?)',tuple(r[k] for k in ['id','category','title_en','title_zh','body_en','body_zh','url','publisher','accessed']))
 for r in catalog['community']:
  db.execute('INSERT INTO community VALUES(?,?,?,?,?,?,?,?)',tuple(r[k] for k in ['id','title_en','title_zh','body_en','body_zh','url','platform','accessed']))
 for r in catalog['sources']:db.execute('INSERT INTO sources VALUES(?,?)',(r['id'],json.dumps(r,ensure_ascii=False)))
 counts={t:db.execute('SELECT COUNT(*) FROM '+t).fetchone()[0] for t in ['agents','rentals','listings','guides','community','sources']}
 latest=max(r['rent_approval_date'] for r in rentals)
 for k,v in {'schema':2,'accessed':catalog['accessed'],'counts':counts,'rental_range':['2021-01',latest]}.items():db.execute('INSERT INTO metadata VALUES(?,?)',(k,json.dumps(v,ensure_ascii=False)))
 db.commit();assert db.execute('PRAGMA integrity_check').fetchone()[0]=='ok';db.execute('VACUUM');db.close()
 catalog['counts']=counts;catalog['rental_range']=['2021-01',latest];catalog['sha256_db']=hashlib.sha256(dbpath.read_bytes()).hexdigest()
 catalog['source_csv_hashes']={pathlib.Path(s).name:hashlib.sha256(pathlib.Path(s).read_bytes()).hexdigest() for s in [a.cea,a.hdb]}
 (out/'catalog.json').write_text(json.dumps(catalog,ensure_ascii=False,separators=(',',':')),encoding='utf-8')
 print(json.dumps({'counts':counts,'database_bytes':dbpath.stat().st_size,'sha256':catalog['sha256_db']},indent=2))
if __name__=='__main__':main()
