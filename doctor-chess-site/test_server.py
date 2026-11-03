import os,tempfile,threading,json,urllib.request,http.cookiejar,unittest,time,importlib.util
from pathlib import Path
TEMP=tempfile.TemporaryDirectory();os.environ['DOCTOR_CHESS_DB']=str(Path(TEMP.name)/'test.sqlite3')
import server
httpd=server.ThreadingHTTPServer(('127.0.0.1',0),server.Handler);threading.Thread(target=httpd.serve_forever,daemon=True).start();BASE=f'http://127.0.0.1:{httpd.server_port}'
def client():return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))
def call(c,path,data=None):
    req=urllib.request.Request(BASE+'/api/'+path,data=None if data is None else json.dumps(data).encode(),headers={'Content-Type':'application/json','Origin':BASE})
    try:
        with c.open(req) as r:return r.status,json.load(r)
    except urllib.error.HTTPError as e:return e.code,json.load(e)
class Integration(unittest.TestCase):
    def test_complete_flow(self):
        a,b,anon=client(),client(),client()
        self.assertEqual(call(anon,'queue',{'control':'5+0'})[0],401)
        self.assertEqual(call(a,'register',{'username':'Alpha','password':'test-pass-123'})[0],200)
        self.assertEqual(call(b,'register',{'username':'Beta','password':'test-pass-123'})[0],200)
        self.assertEqual(call(anon,'register',{'username':'Alpha','password':'test-pass-123'})[0],409)
        self.assertEqual(call(a,'profile',{'bio':'I love chess'})[1]['user']['bio'],'I love chess')
        self.assertTrue(call(a,'queue',{'control':'5+0'})[1]['queued'])
        g=call(b,'queue',{'control':'5+0'})[1]['game'];gid=g['id']
        ga=call(a,'state')[1]['game'];self.assertEqual(ga['id'],gid)
        self.assertEqual(call(anon,'games/'+gid)[0],404)
        white=a if ga['you']=='w' else b;black=b if white==a else a
        self.assertEqual(call(black,'move',{'game':gid,'from':12,'to':28})[0],409)
        self.assertEqual(call(white,'move',{'game':gid,'from':52,'to':20})[0],400)
        for c,i,j in [(white,53,45),(black,12,28),(white,54,38),(black,3,39)]:
            code,out=call(c,'move',{'game':gid,'from':i,'to':j});self.assertEqual(code,200,out)
        self.assertEqual(out['game']['result'],'b')
        self.assertEqual(out['game']['reason'],'Чёрные победили. Мат.')
        code,review=call(anon,'games/'+gid)
        self.assertEqual(code,200);self.assertEqual(len(review['game']['moves']),4)
        self.assertNotIn('payload',review['game']);self.assertNotIn('password',json.dumps(review))
        with anon.open(BASE+'/review/'+gid) as r:self.assertEqual(r.status,200)
        self.assertEqual(call(white,'me')[1]['user']['ratings']['blitz']['rating'],1188)
        self.assertEqual(call(black,'me')[1]['user']['ratings']['blitz']['rating'],1212)
        call(white,'resign',{'game':gid});self.assertEqual(call(black,'me')[1]['user']['ratings']['blitz']['played'],1)
        self.assertEqual(call(a,'leaderboard')[1]['blitz'][0]['rating'],1212)
        self.assertEqual(call(a,'me')[1]['user']['ratings']['rapid']['played'],0)
        call(a,'queue',{'control':'10+0'});g=call(b,'queue',{'control':'10+0'})[1]['game'];gid=g['id']
        self.assertIsNone(call(a,'draw',{'game':gid})[1]['game']['result'])
        self.assertEqual(call(b,'draw',{'game':gid})[1]['game']['result'],'draw')
        call(a,'queue',{'control':'1+0'});g=call(b,'queue',{'control':'1+0'})[1]['game'];gid=g['id']
        with server.lock:
            p=server.game_row(gid)['payload'];p['tick']=time.time()-70;server.db.execute('UPDATE games SET payload=? WHERE id=?',(json.dumps(p),gid))
        self.assertEqual(call(a,'state')[1]['game']['result'],'b')
        call(a,'queue',{'control':'3+2'});self.assertTrue(call(a,'state')[1]['queued']);call(a,'cancel',{});self.assertFalse(call(a,'state')[1]['queued'])
        self.assertEqual(call(a,'logout',{})[0],200);self.assertIsNone(call(a,'me')[1]['user'])
        self.assertEqual(call(a,'login',{'username':'Alpha','password':'incorrect'})[0],401)
        self.assertEqual(call(a,'login',{'username':'Alpha','password':'test-pass-123'})[1]['user']['bio'],'I love chess')
        self.assertNotIn('password',call(a,'me')[1]['user'])
        self.assertEqual(call(anon,'profile',{'bio':'changed'})[0],401)
        self.assertEqual(call(a,'profile',{'bio':'<script>alert(1)</script>','avatar':'bamboo'})[0],200)
        self.assertEqual(call(a,'profile',{'avatar':'invalid'})[0],400)
        code,out=call(anon,'players/Alpha')
        self.assertEqual(code,200);p=out['player']
        self.assertEqual(p['avatar'],'bamboo');self.assertEqual(p['stats']['played'],3)
        self.assertEqual(sum(p['stats'][k] for k in ['wins','draws','losses']),3)
        self.assertEqual(len(p['games']),3)
        self.assertEqual(set(p),{'id','username','bio','created','avatar','ratings','stats','games','page','total_games'})
        self.assertNotIn('password',json.dumps(out));self.assertNotIn('salt',json.dumps(out))
        self.assertEqual(call(anon,'players/Alpha?category=rapid')[1]['player']['total_games'],1)
        self.assertEqual(call(anon,'players/Alpha?page=2')[1]['player']['games'],[])
        self.assertEqual(call(anon,'players/nobody')[0],404)
        self.assertEqual(call(anon,'players/Alpha?page=bad')[0],400)
        self.assertEqual(call(anon,'players?search=Alpha')[1]['players'][0]['username'],'Alpha')
        with anon.open(BASE+'/player/Alpha') as r:
            html=r.read().decode();self.assertEqual(r.status,200);self.assertIn('src="/community.js"',html)

def tearDownModule():
    httpd.shutdown()
    httpd.server_close()
    server.db.close()
    TEMP.cleanup()
if __name__=='__main__':unittest.main()
