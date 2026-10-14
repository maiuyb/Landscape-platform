# -*- coding: utf-8 -*-
"""写入社区演示数据。幂等：已有配方时默认跳过。

演示账号 demo 拥有 6 条作品（明快版），其他 3 位用户各拥有若干（原始版），
共 12 张样例图 —— 每张图一条内容，用于浏览与收藏测试。
"""

from db import get_db, init_db
import repository as repo
from auth import hash_password

DEMO_ACCOUNT = ('demo', 'demo1234')
OTHER_USERS = [
    ('山间旅人', 'demo1234'),
    ('光影猎人', 'demo1234'),
    ('云上摄影', 'demo1234'),
]

# (名称, 分类, 标签, 描述, 图片, 所有者, steps)
RECIPES = [
    # ---- demo 的 6 条作品（明快版）----
    ('通透日落', '日落', ['日落', '通透', '暖色'], '增强夕阳暖色，提亮阴影，让天空更有层次。',
     'sunset_after.jpg', 'demo',
     [{'type': 'exposure', 'params': {'value': 6}},
      {'type': 'temperature', 'params': {'value': 18}},
      {'type': 'saturation', 'params': {'value': 12}},
      {'type': 'shadows', 'params': {'value': 20}},
      {'type': 'filter', 'params': {'name': 'warm-autumn'}}]),
    ('冷调雪景', '雪景', ['雪景', '冷调', '通透'], '压暗高光避免死白，加入冷色调突出雪地质感。',
     'snow_after.jpg', 'demo',
     [{'type': 'highlights', 'params': {'value': -20}},
      {'type': 'temperature', 'params': {'value': -14}},
      {'type': 'contrast', 'params': {'value': 10}},
      {'type': 'filter', 'params': {'name': 'cool-tone'}}]),
    ('森系清新', '森林', ['森林', '清新', '绿色'], '提升绿色饱和度与明亮度，营造清新的森林氛围。',
     'forest_after.jpg', 'demo',
     [{'type': 'brightness', 'params': {'value': 10}},
      {'type': 'saturation', 'params': {'value': 16}},
      {'type': 'shadows', 'params': {'value': 14}},
      {'type': 'filter', 'params': {'name': 'clarity'}}]),
    ('海雾蓝调', '海景', ['海洋', '蓝调', '雾感'], '轻微去饱和，冷色偏移，呈现安静的海边雾感。',
     'ocean_after.jpg', 'demo',
     [{'type': 'saturation', 'params': {'value': -8}},
      {'type': 'temperature', 'params': {'value': -10}},
      {'type': 'shadows', 'params': {'value': 12}},
      {'type': 'filter', 'params': {'name': 'cool-tone'}}]),
    ('暖秋胶卷', '秋景', ['秋天', '胶卷', '暖色'], '胶片风格：高对比、暖色、略降饱和，复古耐看。',
     'autumn_after.jpg', 'demo',
     [{'type': 'contrast', 'params': {'value': 18}},
      {'type': 'saturation', 'params': {'value': -6}},
      {'type': 'temperature', 'params': {'value': 10}},
      {'type': 'shadows', 'params': {'value': 16}},
      {'type': 'filter', 'params': {'name': 'film'}}]),
    ('空灵晨雾', '雾景', ['雾', '极简', '低饱和'], '低饱和、低对比，保留雾气的空灵和留白。',
     'fog_after.jpg', 'demo',
     [{'type': 'contrast', 'params': {'value': -10}},
      {'type': 'saturation', 'params': {'value': -12}},
      {'type': 'brightness', 'params': {'value': 8}},
      {'type': 'filter', 'params': {'name': 'clarity'}}]),

    # ---- 其他用户的 6 条内容（原始版，供收藏测试）----
    ('暮色降临', '日落', ['日落', '原片'], '逆光下的原片，保留天空层次。',
     'sunset_before.jpg', '山间旅人',
     [{'type': 'brightness', 'params': {'value': 5}},
      {'type': 'filter', 'params': {'name': 'clarity'}}]),
    ('雪后初霁', '雪景', ['雪景', '原片'], '雪后初晴的冷调原片。',
     'snow_before.jpg', '光影猎人',
     [{'type': 'contrast', 'params': {'value': 6}},
      {'type': 'filter', 'params': {'name': 'cool-tone'}}]),
    ('林间晨光', '森林', ['森林', '原片'], '清晨林间的柔和光线。',
     'forest_before.jpg', '云上摄影',
     [{'type': 'shadows', 'params': {'value': 8}},
      {'type': 'filter', 'params': {'name': 'clarity'}}]),
    ('潮汐蓝调', '海景', ['海洋', '原片'], '海边涨潮时的低饱和画面。',
     'ocean_before.jpg', '山间旅人',
     [{'type': 'saturation', 'params': {'value': -5}},
      {'type': 'filter', 'params': {'name': 'cool-tone'}}]),
    ('秋意浓', '秋景', ['秋天', '原片'], '秋日暖阳下的原片记录。',
     'autumn_before.jpg', '光影猎人',
     [{'type': 'temperature', 'params': {'value': 8}},
      {'type': 'filter', 'params': {'name': 'warm-autumn'}}]),
    ('远山如黛', '雾景', ['雾', '原片'], '雾中远山，朦胧而平静。',
     'fog_before.jpg', '云上摄影',
     [{'type': 'brightness', 'params': {'value': 4}},
      {'type': 'filter', 'params': {'name': 'film'}}]),
]


def seed_demo(force=False):
    init_db()
    conn = get_db()
    try:
        if repo.count_recipes(conn) and not force:
            return 0

        # 账号
        user_ids = {}
        for username, password in [DEMO_ACCOUNT] + OTHER_USERS:
            row = repo.get_user_by_username(conn, username)
            user_ids[username] = row['id'] if row else repo.create_user(
                conn, username, hash_password(password))

        if force:
            conn.execute('DELETE FROM recipes')
            conn.commit()

        for i, (name, category, tags, desc, image, owner, steps) in enumerate(RECIPES):
            url = '/uploads/' + image
            repo.insert_recipe(conn, {
                'name': name, 'author': owner, 'author_id': user_ids[owner],
                'description': desc, 'category': category, 'tags': tags,
                'cover_before': url, 'cover_after': url,
                'steps': steps, 'features': {'avgH': 0, 'avgS': 0, 'avgV': 0},
            })
        # 让 created_at 有差异，便于“按最新”排序
        for i in range(len(RECIPES)):
            conn.execute('UPDATE recipes SET created_at = datetime(\'now\', ?) WHERE id = ?',
                         ('-%d minutes' % (len(RECIPES) - i), i + 1))
        conn.commit()
        return len(RECIPES)
    finally:
        conn.close()


if __name__ == '__main__':
    n = seed_demo(force=True)
    print('seeded recipes:', n)
